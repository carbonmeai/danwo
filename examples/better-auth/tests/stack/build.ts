/**
 * The tests run the API serving the production build of the web app (`vite build web`). The
 * first worker to start builds when the build is missing or older than the app's code, and the
 * others wait for it, so `danwo test` alone is enough after editing the app.
 */
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)

/** The example's folder, where its scripts and node_modules are. */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** Where the build goes, which the API serves. */
export const WEB_DIST = join(ROOT, "web", "dist")

/** What the build is made from: a change to any of these makes it stale. */
const SOURCES = ["web/src", "web/index.html", "web/vite.config.ts", "kit", "package.json"]

/** Held while one worker builds; `mkdir` makes taking it atomic. */
const LOCK = join(ROOT, ".web-build-lock")

/** The file the build writes; it exists once a build is complete. */
const BUILT = join(WEB_DIST, "index.html")

/** The newest modification time under `path`. */
function newest(path: string): number {
  const stats = statSync(path)

  if (!stats.isDirectory()) return stats.mtimeMs

  return Math.max(stats.mtimeMs, ...readdirSync(path).map((name) => newest(join(path, name))))
}

/** Whether a complete build exists that is newer than every source. */
function fresh(): boolean {
  const sources = SOURCES.map((source) => join(ROOT, source)).filter(existsSync)

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

/** Runs `vite build web`; a failure carries the end of its output. */
async function build(): Promise<void> {
  try {
    await run(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "build", "web"], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${String(Reflect.get(Object(error), "stdout") ?? "")}${String(Reflect.get(Object(error), "stderr") ?? "")}`

    throw new Error(`vite build failed:\n${output.split("\n").slice(-40).join("\n")}`)
  }
}

/** Builds the web app unless a fresh build exists; resolves once one does. */
export async function ensureBuilt(): Promise<void> {
  const deadline = Date.now() + 5 * 60_000

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
      throw new Error(`no fresh build of the web app; is ${LOCK} left over?`)
    await new Promise((resolve) => setTimeout(resolve, 500))
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
