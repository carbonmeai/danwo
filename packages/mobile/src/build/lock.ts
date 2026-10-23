/**
 * One build of a project at a time, across workers and processes. Each worker of a run builds its
 * app before it starts, so on a cold build they would all run `xcodebuild` or Gradle in the same
 * folders at once, and the tools fail on each other's files ("database is locked"). The first
 * worker takes the project's lock and builds; the others wait for it, then find the kept build.
 *
 * The lock is a file created with `wx` (O_EXCL), which is atomic on every platform, Windows
 * included, holding its owner's pid. A lock whose owner has died is broken; waiting longer than the
 * timeout fails with what holds it.
 */
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** What the lock reads from the system; tests pass their own. */
export interface LockSystem {
  /** This process's pid. */
  readonly pid: number
  /** Whether a process with `pid` is running. */
  readonly alive: (pid: number) => boolean
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

/** Options of `withBuildLock`. */
export interface BuildLockOptions {
  /** How long to wait for another build before failing. Default 30 minutes. */
  readonly timeoutMs?: number | undefined
  /** Told once when this build waits for another. */
  readonly onWait?: ((holder: string) => void) | undefined
  readonly system?: LockSystem | undefined
}

/** Who holds a lock, as its file says. */
interface Holder {
  readonly pid: number
  readonly token: string
  readonly since: number
}

const DEFAULT_TIMEOUT_MS = 30 * 60_000
const POLL_MS = 250
/** A lock file with no owner in it yet is being written; one older than this was abandoned. */
const UNWRITTEN_GRACE_MS = 10_000

/** Whether `pid` runs: signal 0 checks without signalling, on Windows too. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    /* EPERM: it runs, as another user. */
    return error instanceof Error && Reflect.get(error, "code") === "EPERM"
  }
}

const SYSTEM: LockSystem = {
  pid: process.pid,
  alive: processAlive,
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

function errorCode(error: unknown): unknown {
  return error instanceof Error ? Reflect.get(error, "code") : undefined
}

/** The lock's owner, or undefined when the file is gone or not yet written. */
async function holderOf(file: string): Promise<Holder | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
    const pid: unknown = Reflect.get(Object(parsed), "pid")
    const token: unknown = Reflect.get(Object(parsed), "token")
    const since: unknown = Reflect.get(Object(parsed), "since")

    return typeof pid === "number" && typeof token === "string" && typeof since === "number"
      ? { pid, token, since }
      : undefined
  } catch {
    return undefined
  }
}

/** Whether the lock at `file` was left by a build that is not running any more. */
async function abandoned(file: string, system: LockSystem): Promise<boolean> {
  const holder = await holderOf(file)

  if (holder !== undefined) return !system.alive(holder.pid)

  try {
    return system.now() - (await stat(file)).mtimeMs > UNWRITTEN_GRACE_MS
  } catch {
    /* Released meanwhile: nothing to break. */
    return false
  }
}

/** Takes the lock at `file` if it is free; true when this call holds it now. */
async function take(file: string, holder: Holder): Promise<boolean> {
  try {
    await writeFile(file, JSON.stringify(holder), { flag: "wx" })

    return true
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false

    throw error
  }
}

/** A wait as people say it: seconds under two minutes, else minutes. */
function waited(ms: number): string {
  return ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`
}

/** What holds the lock, for a message. */
async function holderText(file: string): Promise<string> {
  const holder = await holderOf(file)

  return holder === undefined
    ? "another build"
    : `the build of pid ${holder.pid}, running since ${new Date(holder.since).toISOString()}`
}

/**
 * Runs `build` holding the lock at `file`: at once when no other build holds it, else once that
 * build ends (or its process has died). The lock is released however `build` ends.
 */
export async function withBuildLock<T>(
  file: string,
  build: () => Promise<T>,
  options: BuildLockOptions = {},
): Promise<T> {
  const system = options.system ?? SYSTEM
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const holder: Holder = { pid: system.pid, token: randomUUID(), since: system.now() }
  const deadline = system.now() + timeoutMs
  let told = false

  await mkdir(dirname(file), { recursive: true })

  while (!(await take(file, { ...holder, since: system.now() }))) {
    if (await abandoned(file, system)) {
      await rm(file, { force: true })
      continue
    }

    if (system.now() >= deadline)
      throw new Error(
        `waited ${waited(timeoutMs)} for ${await holderText(file)} to finish building; if no build is running, delete ${file}`,
      )

    if (!told) {
      told = true
      options.onWait?.(await holderText(file))
    }

    await system.sleep(POLL_MS)
  }

  try {
    return await build()
  } finally {
    /* Only this build's own lock: one broken as stale may have been taken by another since. */
    if ((await holderOf(file))?.token === holder.token) await rm(file, { force: true })
  }
}
