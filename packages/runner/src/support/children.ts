/**
 * Child processes that must not outlive whoever started them: an app or dev server, a worker, a
 * fixture's server. Each one starts as the leader of its own process group, so stopping it stops
 * what it started too (a dev command often runs the server as its own child). Every owned group is
 * kept in a registry: a normal exit signals what is left, a SIGINT, SIGTERM or SIGHUP with no other
 * handler stops them before the process ends, and a small guardian process ends them when the
 * owner dies without running any code at all (SIGKILL, a crash in native code).
 *
 * Windows has no process groups: there a child is stopped with its whole tree by `taskkill /T /F`,
 * since signalling the `shell: true` wrapper alone leaves the server it started running. Windows
 * has no guardian either, so a process killed outright can still leave its children behind.
 */
import { type ChildProcess, spawn, type SpawnOptions, spawnSync } from "node:child_process"
import type { Socket } from "node:net"
import { fileURLToPath } from "node:url"

/** How long a group gets between SIGTERM and SIGKILL. */
const GRACE_MS = 3_000
const POLL_MS = 50
const GUARDIAN = fileURLToPath(new URL("./guardian.ts", import.meta.url))
/** Strips types under `node_modules`, where Node will not, so the guardian runs from an install. */
const INSTALLED_HOOK = new URL("../../strip-types.mjs", import.meta.url).href
const SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"]
const GROUPS = process.platform !== "win32"

/** A started child and how to stop it with everything it started. */
export interface OwnedChild {
  readonly child: ChildProcess
  /** Ends the child's group: SIGTERM, then SIGKILL once `graceMs` passes. Safe to call twice. */
  stop(graceMs?: number): Promise<void>
}

const owned = new Map<number, ChildProcess>()
let guardian: ChildProcess | undefined
let hooked = false

/**
 * The command that ends `pid` and every process under it on Windows. `/F` because console
 * programs, a Node server among them, ignore the polite close `taskkill` sends otherwise.
 */
export function treeKillCommand(pid: number): readonly [string, readonly string[]] {
  return ["taskkill", ["/T", "/F", "/PID", String(pid)]]
}

/** Ends the child's process tree on Windows; synchronous, so it also works in an exit handler. */
function killTree(pid: number): void {
  const [command, args] = treeKillCommand(pid)

  spawnSync(command, args, { stdio: "ignore", windowsHide: true })
}

/** Sends `signal` to the child's whole group (its whole tree on Windows). */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (GROUPS && child.pid !== undefined) process.kill(-child.pid, signal)
    else if (process.platform === "win32" && child.pid !== undefined) killTree(child.pid)
    else child.kill(signal)
  } catch {
    /* Already gone. */
  }
}

/** Whether anything in the group led by `pid` still runs. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(GROUPS ? -pid : pid, 0)

    return true
  } catch {
    return false
  }
}

function tellGuardian(line: string): void {
  if (guardian?.stdin?.writable) guardian.stdin.write(`${line}\n`)
}

/** Starts the guardian once: it holds a pipe from this process and reaps what is left when it closes. */
function ensureGuardian(): void {
  if (guardian !== undefined || !GROUPS) return

  guardian = spawn(process.execPath, ["--import", INSTALLED_HOOK, GUARDIAN, String(GRACE_MS)], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  })
  guardian.on("error", () => undefined)
  guardian.unref()
  /* The pipe stays open for as long as this process lives, but must not keep it alive. */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a piped stdio stream is a net.Socket
  ;(guardian.stdin as Socket | null)?.unref()
}

/** On a signal nobody else handles, stops every owned group and then lets the signal end the process. */
function onSignal(signal: NodeJS.Signals): void {
  const handler = () => {
    if (process.listenerCount(signal) > 1) return

    void stopAll().finally(() => {
      process.off(signal, handler)
      process.kill(process.pid, signal)
    })
  }

  process.on(signal, handler)
}

function hook(): void {
  if (hooked) return

  hooked = true
  process.on("exit", () => {
    /* No time to wait here: SIGTERM now, and the guardian escalates once this process is gone. */
    for (const child of owned.values()) signalGroup(child, "SIGTERM")
  })
  for (const signal of SIGNALS) onSignal(signal)
}

/** Takes ownership of `child`, which must have been started with `detached: true` where groups exist. */
export function own(child: ChildProcess): OwnedChild {
  const pid = child.pid

  if (pid !== undefined) {
    hook()
    ensureGuardian()
    owned.set(pid, child)
    tellGuardian(`+${pid}`)
    /* A leader that ends with nothing left in its group needs no stopping, and its pid may be reused. */
    child.once("exit", () => {
      if (groupAlive(pid)) return

      owned.delete(pid)
      tellGuardian(`-${pid}`)
    })
  }

  let stopping: Promise<void> | undefined

  return {
    child,
    stop(graceMs = GRACE_MS) {
      stopping ??= stopGroup(child, graceMs)

      return stopping
    },
  }
}

async function stopGroup(child: ChildProcess, graceMs: number): Promise<void> {
  const pid = child.pid

  if (pid === undefined) return

  signalGroup(child, "SIGTERM")

  const deadline = Date.now() + graceMs

  while (groupAlive(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))

  if (groupAlive(pid)) signalGroup(child, "SIGKILL")
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => child.once("exit", resolve))

  owned.delete(pid)
  tellGuardian(`-${pid}`)
}

/**
 * `spawn()` for a child danwo owns: it leads its own process group and is stopped, with what it
 * started, when its owner stops it, exits, is interrupted or dies.
 */
export function spawnOwned(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): OwnedChild {
  return own(spawn(command, [...args], { ...options, detached: GROUPS }))
}

/** Stops every group this process still owns. */
export async function stopAll(graceMs = GRACE_MS): Promise<void> {
  await Promise.all([...owned.values()].map((child) => stopGroup(child, graceMs)))
}

/** How many groups this process owns right now. */
export function ownedCount(): number {
  return owned.size
}
