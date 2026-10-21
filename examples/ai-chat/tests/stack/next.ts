/**
 * The tests run the production server (`next start`), which needs a build. The first worker to
 * start builds when the build is missing or older than the app's code, and the others wait for it,
 * so `danwo test` alone is enough after editing the app.
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

/** The example's folder. */
const ROOT = new URL("../..", import.meta.url).pathname

/** What a build is made from: a change to any of these makes it stale. */
const SOURCES = ["app", "lib", "kit", "next.config.ts", "postcss.config.json", "package.json"]

/** Held while one worker builds; `mkdir` makes taking it atomic. */
const LOCK = join(ROOT, ".next-build-lock")

/** The file Next.js writes last, once a build is complete. */
const BUILD_ID = join(ROOT, ".next", "BUILD_ID")

/** The newest modification time under `path`. */
function newest(path: string): number {
  const stats = statSync(path)

  if (!stats.isDirectory()) return stats.mtimeMs

  return Math.max(stats.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))))
}

/** Whether a complete build exists that is newer than every source. */
function fresh(): boolean {
  return (
    existsSync(BUILD_ID) &&
    statSync(BUILD_ID).mtimeMs >=
      Math.max(
        ...SOURCES.map((source) => join(ROOT, source))
          .filter(existsSync)
          .map(newest),
      )
  )
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

/** A port nothing listens on right now, for a worker's server. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0

      server.close(() => resolve(port))
    })
  })
}

/** Runs `next build`; a failure carries the end of its output. */
async function build(): Promise<void> {
  try {
    await run("npx", ["--no", "next", "build"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const output = `${String(Reflect.get(Object(error), "stdout") ?? "")}${String(Reflect.get(Object(error), "stderr") ?? "")}`

    throw new Error(`next build failed:\n${output.split("\n").slice(-40).join("\n")}`)
  }
}

/** Builds the app unless a fresh build exists; resolves once one does. */
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
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
