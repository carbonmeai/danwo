/**
 * What `danwo.config.ts` needs besides danwo itself: a fresh build of the storefront, and a
 * database of its own for each worker (the schema pushed, the catalogue seeded).
 */
import { execFile, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { spawnOwned } from "@danwo/sdk"
import pg from "pg"

import { CATALOG, imageKey } from "../seed/catalog.ts"
import { assertTestDatabase, sqlOn } from "./db.ts"

const run = promisify(execFile)

/** The example's folder, where its scripts and node_modules are. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** What the storefront's build is made from: a change to any of these makes it stale. */
const SOURCES = [
  "web/app",
  "web/components",
  "web/lib",
  "web/next.config.ts",
  "kit",
  "package.json",
]

/** Held while one worker builds; `mkdir` makes taking it atomic. */
const LOCK = join(ROOT, ".next-build-lock")

/** The file Next.js writes last, once a build is complete. */
const BUILD_ID = join(ROOT, "web", ".next", "BUILD_ID")

/** The newest modification time under `path`. */
function newest(path: string): number {
  const stats = statSync(path)

  if (!stats.isDirectory()) return stats.mtimeMs

  return Math.max(stats.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))))
}

/** Whether a complete build exists that is newer than every source. */
function fresh(): boolean {
  const sources = SOURCES.map((source) => join(ROOT, source)).filter(existsSync)

  return existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= Math.max(...sources.map(newest))
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

/** Runs `next build web`; a failure carries the end of its output. */
async function build(): Promise<void> {
  try {
    await run(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "build", "web"], {
      cwd: ROOT,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${String(Reflect.get(Object(error), "stdout") ?? "")}${String(Reflect.get(Object(error), "stderr") ?? "")}`

    throw new Error(`next build failed:\n${output.split("\n").slice(-40).join("\n")}`)
  }
}

/**
 * Builds the storefront unless a fresh build exists. The first worker to start builds, the others
 * wait for it, so `danwo test` alone is enough after editing the app.
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

    if (Date.now() > deadline)
      throw new Error(`no fresh build of the storefront; is ${LOCK} left over?`)
    await new Promise((resolve) => setTimeout(resolve, 500))
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
        "could not start Postgres in Docker. Start Docker, or set DATABASE_URL to a Postgres you run, e.g. postgres://postgres@127.0.0.1:5432/commerce_test",
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
  const name = `danwo-commerce-${process.pid}-w${workerIndex}`
  const owned = spawnOwned(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      "--label",
      "danwo-example=commerce",
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

/** Creates the shop's tables from its Drizzle schema with `drizzle-kit push`. */
function pushSchema(url: string): void {
  const pushed = spawnSync(
    process.execPath,
    [join(ROOT, "node_modules/drizzle-kit/bin.cjs"), "push", "--force"],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" },
  )

  if (pushed.status !== 0)
    throw new Error(`drizzle-kit push failed:\n${pushed.stdout}\n${pushed.stderr}`)
}

/** Empties the shop's tables and puts the catalogue back, as every run starts. */
export async function seedDatabase(url: string): Promise<void> {
  const sql = sqlOn(url)

  await sql(
    "truncate order_items, orders, checkouts, cart_items, carts, webhook_events, products restart identity cascade",
  )

  for (const product of CATALOG)
    await sql(
      `insert into products (slug, name, category, description, price_cents, stripe_price_id, image_key, stock)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        product.slug,
        product.name,
        product.category,
        product.description,
        product.priceCents,
        product.stripePrice,
        imageKey(product.slug),
        product.stock,
      ],
    )
}

/** A worker's database: its URL, and how to drop it (and its container) when the worker ends. */
export interface WorkerDatabase {
  readonly url: string
  close(): Promise<void>
}

/**
 * A fresh database for one worker, `commerce_w<n>_test`: created, migrated and seeded, so each run
 * starts from it whatever the last run left, and parallel workers never share rows. With
 * `DATABASE_URL` set (its database name must end in `_test`), it is made on that server, which is
 * never written to otherwise; without it, the worker starts a throwaway Postgres in Docker.
 */
export async function workerDatabase(workerIndex: number): Promise<WorkerDatabase> {
  const given = process.env.DATABASE_URL

  if (given !== undefined) assertTestDatabase(given)

  const container = given === undefined ? await startContainer(workerIndex) : undefined
  const server = given ?? container?.server ?? ""
  const name = `commerce_w${workerIndex}_test`
  const admin = onServer(server, "postgres")
  const url = onServer(server, name)

  try {
    await execute(admin, [
      `drop database if exists "${name}" with (force)`,
      `create database "${name}"`,
    ])
    pushSchema(url)
    await seedDatabase(url)
  } catch (error) {
    await container?.stop()
    throw error
  }

  return {
    url,
    async close() {
      if (container) await container.stop()
      else await execute(admin, [`drop database if exists "${name}" with (force)`])
    },
  }
}
