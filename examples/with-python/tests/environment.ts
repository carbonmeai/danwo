/**
 * What `danwo.config.ts` needs besides danwo itself: the API's Python environment, a fresh build
 * of the site, and a database of its own for each worker (the tables created, the timetable
 * seeded).
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { spawnOwned } from "@danwo/sdk"
import pg from "pg"

import { assertTestDatabase, sqlOn } from "./db.ts"

const run = promisify(execFile)

/** The example's folder, where its scripts and node_modules are. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** The API's folder, where its pyproject.toml and uv.lock are. */
export const API_DIR = join(ROOT, "api")

/** The site's folder: SvelteKit, built into `web/build` and served with `node build`. */
export const WEB_DIR = join(ROOT, "web")

/** One class on the timetable, as `seed/classes.json` lists it. */
export interface StudioClass {
  readonly slug: string
  readonly name: string
  readonly instructor: string
  readonly starts: string
  readonly minutes: number
  readonly description: string
  readonly priceCents: number
  readonly capacity: number
}

/** The week's classes, seeded into Postgres and, as prices, into Stripe. */
export const CLASSES: readonly StudioClass[] = JSON.parse(
  readFileSync(new URL("../seed/classes.json", import.meta.url), "utf8"),
)

/** The Stripe price a class is sold at. */
export function stripePrice(slug: string): string {
  return `price_${slug.replaceAll("-", "_")}`
}

/** Runs `uv` in the API's folder; a failure carries its output. */
async function uv(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    await run("uv", [...args], { cwd: API_DIR, env, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "ENOENT")
      throw new Error("uv is not installed: see https://docs.astral.sh/uv/getting-started/")

    const output = `${String(Reflect.get(Object(error), "stdout") ?? "")}${String(Reflect.get(Object(error), "stderr") ?? "")}`

    throw new Error(`uv ${args.join(" ")} failed:\n${output.split("\n").slice(-30).join("\n")}`)
  }
}

/**
 * Installs the API's Python and packages from `uv.lock` into `api/.venv`, once per worker; uv
 * takes a lock, so workers starting together wait for each other. The API then starts with
 * `uv run --no-sync`, which never reaches the network while danwo's proxy holds its calls.
 */
export function syncPython(): Promise<void> {
  return uv(["sync", "--frozen", "--quiet"])
}

/** What the site's build is made from: a change to any of these makes it stale. */
const WEB_SOURCES = ["web/src", "web/vite.config.ts", "web/package.json", "kit", "package.json"]

/** Held while one worker builds the site; `mkdir` makes taking it atomic. */
const LOCK = join(ROOT, ".web-build-lock")

/** The server adapter-node writes last, once a build is complete. */
const BUILT = join(WEB_DIR, "build", "index.js")

/** The newest modification time under `path`. */
function newest(path: string): number {
  const stats = statSync(path)

  if (!stats.isDirectory()) return stats.mtimeMs

  return Math.max(stats.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))))
}

/** Whether a complete build exists that is newer than every source. */
function fresh(): boolean {
  const sources = WEB_SOURCES.map((source) => join(ROOT, source)).filter(existsSync)

  return existsSync(BUILT) && statSync(BUILT).mtimeMs >= Math.max(...sources.map(newest))
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

/** Runs `vite build` in `web/`; a failure carries the end of its output. */
async function build(): Promise<void> {
  try {
    await run(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "build"], {
      cwd: WEB_DIR,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${String(Reflect.get(Object(error), "stdout") ?? "")}${String(Reflect.get(Object(error), "stderr") ?? "")}`

    throw new Error(`vite build failed:\n${output.split("\n").slice(-40).join("\n")}`, {
      cause: error,
    })
  }
}

/**
 * Builds the site unless a fresh build exists. The first worker to start builds, the others wait
 * for it, so every worker serves the same build and `danwo test` alone is enough after an edit.
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

    if (Date.now() > deadline) throw new Error(`no fresh build of the site; is ${LOCK} left over?`)
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
        "could not start Postgres in Docker. Start Docker, or set DATABASE_URL to a Postgres you run, e.g. postgres://postgres@127.0.0.1:5432/studio_test",
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
  const name = `danwo-with-python-${process.pid}-w${workerIndex}`
  const owned = spawnOwned(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      "--label",
      "danwo-example=with-python",
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

/** Creates the API's tables with its own `python -m studio.schema`, as a deploy step would. */
function createTables(url: string): Promise<void> {
  return uv(["run", "--no-sync", "python", "-m", "studio.schema"], {
    ...process.env,
    DATABASE_URL: url,
  })
}

/** Empties the app's tables and puts the timetable back, as every run starts. */
export async function seedDatabase(url: string): Promise<void> {
  const sql = sqlOn(url)

  await sql("truncate bookings, webhook_events, classes restart identity cascade")

  for (const klass of CLASSES)
    await sql(
      `insert into classes (slug, name, instructor, starts, minutes, description, price_cents, stripe_price_id, capacity)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        klass.slug,
        klass.name,
        klass.instructor,
        klass.starts,
        klass.minutes,
        klass.description,
        klass.priceCents,
        stripePrice(klass.slug),
        klass.capacity,
      ],
    )
}

/** A worker's database: its URL, and how to drop it (and its container) when the worker ends. */
export interface WorkerDatabase {
  readonly url: string
  close(): Promise<void>
}

/**
 * A fresh database for one worker, `studio_w<n>_test`: created, its tables made and the timetable
 * seeded, so each run starts from it whatever the last run left, and parallel workers never share
 * rows. With `DATABASE_URL` set (its database name must end in `_test`), it is made on that
 * server, which is never written to otherwise; without it, the worker starts Postgres in Docker.
 */
export async function workerDatabase(workerIndex: number): Promise<WorkerDatabase> {
  const given = process.env.DATABASE_URL

  if (given !== undefined) assertTestDatabase(given)

  const container = given === undefined ? await startContainer(workerIndex) : undefined
  const server = given ?? container?.server ?? ""
  const name = `studio_w${workerIndex}_test`
  const admin = onServer(server, "postgres")
  const url = onServer(server, name)

  try {
    await execute(admin, [
      `drop database if exists "${name}" with (force)`,
      `create database "${name}"`,
    ])
    await createTables(url)
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
