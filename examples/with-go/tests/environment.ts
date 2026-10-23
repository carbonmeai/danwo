/**
 * What `danwo.config.ts` needs besides danwo itself: one build of the Go app per run, a database
 * of its own for each worker, and free ports.
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { spawnOwned } from "@danwo/sdk"
import pg from "pg"

import { assertTestDatabase, sqlOn } from "./db.ts"

const run = promisify(execFile)

/** The example's folder: the Go module, its scripts and node_modules. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** Where the build puts the app's binary. */
export const BINARY = join(
  ROOT,
  "dist",
  process.platform === "win32" ? "quillwork.exe" : "quillwork",
)

/** A port nothing listens on yet. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      server.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

/** What the binary is built from: a change to any of these makes it stale. */
const SOURCES = ["go.mod", "go.sum", "schema.sql", "templates", "kit"]

/** Held while one worker builds; `mkdir` makes taking it atomic. */
const LOCK = join(ROOT, ".go-build-lock")

/** The newest modification time under `path`. */
function newest(path: string): number {
  const stats = statSync(path)

  if (!stats.isDirectory()) return stats.mtimeMs

  return Math.max(stats.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))))
}

/** Whether the binary exists and is newer than the Go files and everything they embed. */
function fresh(): boolean {
  const goFiles = readdirSync(ROOT)
    .filter((name) => name.endsWith(".go"))
    .map((name) => join(ROOT, name))
  const sources = [...goFiles, ...SOURCES.map((source) => join(ROOT, source)).filter(existsSync)]

  return existsSync(BINARY) && statSync(BINARY).mtimeMs >= Math.max(...sources.map(newest))
}

/** Takes the build lock; false when another worker holds it. */
function lock(): boolean {
  try {
    mkdirSync(LOCK)

    return true
  } catch {
    return false
  }
}

/** Runs `go build`; a failure carries its output, and a missing Go says what to install. */
async function build(): Promise<void> {
  try {
    await run("go", ["build", "-o", BINARY, "."], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "ENOENT")
      throw new Error("go is not on PATH: install Go 1.24 or newer from https://go.dev/dl/", {
        cause: error,
      })

    const output = `${String(Reflect.get(Object(error), "stdout") ?? "")}${String(Reflect.get(Object(error), "stderr") ?? "")}`

    throw new Error(`go build failed:\n${output.split("\n").slice(-40).join("\n")}`, {
      cause: error,
    })
  }
}

/**
 * Builds the app unless a fresh binary exists. The first worker to start builds, the others wait
 * for it, so every worker runs the same binary and none of them compiles on its own.
 */
export async function ensureBuilt(): Promise<void> {
  const deadline = Date.now() + 10 * 60_000

  while (!fresh()) {
    if (lock()) {
      try {
        if (!fresh()) await build()
      } finally {
        rmSync(LOCK, { recursive: true, force: true })
      }

      return
    }

    if (Date.now() > deadline) throw new Error(`no fresh build of the app; is ${LOCK} left over?`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** The image a worker starts when no `DATABASE_URL` is given. */
const POSTGRES_IMAGE = "postgres:17-alpine"

/** How long a fresh container may take to accept connections. */
const READY_MS = 60_000

/** Runs `statements` one by one on the database at `url`. */
async function execute(url: string, statements: readonly string[]): Promise<void> {
  const client = new pg.Client({ connectionString: url })

  await client.connect()
  try {
    for (const statement of statements) await client.query(statement)
  } finally {
    await client.end()
  }
}

/** Waits until Postgres at `url` accepts a connection. */
async function untilReady(url: string): Promise<void> {
  const deadline = Date.now() + READY_MS

  for (;;) {
    try {
      await execute(url, ["select 1"])

      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

/** Where the container's Postgres port is published on this machine, once Docker has it. */
async function publishedAddress(name: string, exited: () => boolean): Promise<string> {
  const deadline = Date.now() + READY_MS

  for (;;) {
    const { stdout } = await run("docker", ["port", name, "5432/tcp"]).catch(() => ({ stdout: "" }))
    const address = stdout.trim().split("\n")[0]

    if (address) return address
    if (exited() || Date.now() > deadline)
      throw new Error(
        "could not start Postgres in Docker. Start Docker, or set DATABASE_URL to a Postgres you run, e.g. postgres://postgres@127.0.0.1:5432/quillwork_test",
      )
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Starts a Postgres container on a free local port; its server URL and how to remove it. `docker
 * run` stays in the foreground as a process danwo owns, so the container goes when the worker
 * does, even when the worker is killed: Docker passes the stop signal on, and `--rm` removes it.
 */
async function startContainer(
  workerIndex: number,
): Promise<{ server: string; stop(): Promise<void> }> {
  const name = `danwo-with-go-${process.pid}-w${workerIndex}`
  const owned = spawnOwned(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      "--label",
      "danwo-example=with-go",
      "--env",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "--publish",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
    ],
    { stdio: "ignore" },
  )
  let exited = false

  owned.child.once("exit", () => {
    exited = true
  })
  owned.child.once("error", () => {
    exited = true
  })

  const stop = async () => {
    await run("docker", ["rm", "--force", name]).catch(() => undefined)
    await owned.stop()
  }

  try {
    const server = `postgres://postgres@${await publishedAddress(name, () => exited)}/postgres`

    await untilReady(server)

    return { server, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

/** The URL of database `name` on the same server as `url`, with the same credentials. */
function onServer(url: string, name: string): string {
  const parsed = new URL(url)

  parsed.pathname = `/${name}`

  return parsed.href
}

/** The app's tables, emptied before every run; the app creates them when it starts. */
const TABLES = ["webhook_events", "subscriptions", "accounts"]

/** A worker's database: its URL, how to empty it, and how to drop it when the worker ends. */
export interface WorkerDatabase {
  readonly url: string
  empty(): Promise<void>
  close(): Promise<void>
}

/**
 * A fresh, empty database for one worker, `quillwork_w<n>_test`; the app creates its tables when
 * it starts. With `DATABASE_URL` set (its database name must end in `_test`), it is made on that
 * server, which is never written to otherwise; without it, the worker starts a throwaway Postgres
 * in Docker.
 */
export async function workerDatabase(workerIndex: number): Promise<WorkerDatabase> {
  const given = process.env.DATABASE_URL

  if (given !== undefined) assertTestDatabase(given)

  const container = given === undefined ? await startContainer(workerIndex) : undefined
  const server = given ?? container?.server ?? ""
  const name = `quillwork_w${workerIndex}_test`
  const admin = onServer(server, "postgres")
  const url = onServer(server, name)

  try {
    await execute(admin, [
      `drop database if exists "${name}" with (force)`,
      `create database "${name}"`,
    ])
  } catch (error) {
    await container?.stop()
    throw error
  }

  return {
    url,
    async empty() {
      await sqlOn(url)(`truncate ${TABLES.join(", ")} restart identity cascade`)
    },
    async close() {
      if (container) await container.stop()
      else await execute(admin, [`drop database if exists "${name}" with (force)`])
    },
  }
}
