/**
 * A Postgres database of its own for each test worker. With `DATABASE_URL` set, it is made on that
 * server; without it, each worker starts a throwaway Postgres in Docker and removes it at the end.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { spawnOwned } from "@danwo/sdk"
import { Client } from "pg"

import { SCHEMA } from "../../api/db.ts"
import { assertTestDatabase } from "../db.ts"

const run = promisify(execFile)

/** The image a worker starts when no `DATABASE_URL` is given. */
const POSTGRES_IMAGE = "postgres:17-alpine"
/** How long a fresh container may take to accept connections. */
const READY_MS = 60_000

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A worker's database: its URL, and how to empty it and drop it (and its container). */
export interface WorkerDatabase {
  readonly url: string
  /** Deletes every signup. */
  empty(): Promise<void>
  close(): Promise<void>
}

/** Runs `statements` one by one on the database at `url`. */
async function execute(url: string, statements: readonly string[]): Promise<void> {
  const client = new Client({ connectionString: url })

  await client.connect()
  try {
    for (const statement of statements) await client.query(statement)
  } finally {
    await client.end()
  }
}

/** Waits until something answers, retrying `attempt` until it succeeds or `READY_MS` passes. */
async function until<T>(attempt: () => Promise<T | undefined>, failure: () => Error): Promise<T> {
  const deadline = Date.now() + READY_MS

  for (;;) {
    const value = await attempt().catch(() => undefined)

    if (value !== undefined) return value
    if (Date.now() > deadline) throw failure()
    await pause(250)
  }
}

/**
 * Starts a Postgres container on a free local port; its server URL and how to remove it. `docker
 * run` stays in the foreground as a process danwo owns, so the container goes when the worker does.
 */
async function startContainer(workerIndex: number) {
  const name = `danwo-with-native-${process.pid}-w${workerIndex}`
  const owned = spawnOwned(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--publish",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
    ],
    { stdio: "ignore" },
  )
  const stop = async () => {
    await run("docker", ["rm", "--force", name]).catch(() => undefined)
    await owned.stop()
  }

  try {
    const address = await until(
      async () => (await run("docker", ["port", name, "5432/tcp"])).stdout.trim().split("\n")[0],
      () =>
        new Error(
          "could not start Postgres in Docker. Start Docker, or set DATABASE_URL to a Postgres you run, e.g. postgres://postgres@127.0.0.1:5432/waitlist_test",
        ),
    )
    const server = `postgres://postgres@${address}/postgres`

    await until(
      () => execute(server, ["select 1"]).then(() => true),
      () => new Error("Postgres in Docker did not accept connections"),
    )

    return { server, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

/** The URL of database `name` on the same server as `url`. */
function onServer(url: string, name: string): string {
  const parsed = new URL(url)

  parsed.pathname = `/${name}`

  return parsed.href
}

/**
 * Creates worker `workerIndex`'s database, `waitlist_w<n>_test`, empty and with the API's table.
 * `DATABASE_URL` names the server and must name a `_test` database itself; it is never written to.
 */
export async function workerDatabase(workerIndex: number): Promise<WorkerDatabase> {
  const given = process.env.DATABASE_URL

  if (given !== undefined) assertTestDatabase(given)

  const container = given === undefined ? await startContainer(workerIndex) : undefined
  const server = given ?? container?.server ?? ""
  const name = `waitlist_w${workerIndex}_test`
  const admin = onServer(server, "postgres")
  const url = onServer(server, name)

  try {
    await execute(admin, [
      `drop database if exists "${name}" with (force)`,
      `create database "${name}"`,
    ])
    await execute(url, [SCHEMA])
  } catch (error) {
    await container?.stop()
    throw error
  }

  return {
    url,
    empty: () => execute(url, ["truncate signups restart identity"]),
    async close() {
      if (container) await container.stop()
      else await execute(admin, [`drop database if exists "${name}" with (force)`])
    },
  }
}
