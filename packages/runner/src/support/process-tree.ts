/**
 * Signalling a process with everything it started, on each platform. Where process groups exist a
 * tree is its group, led by the child danwo started, and a signal to `-pid` reaches all of it.
 * Windows has no groups and no polite stop a console program honours: a tree there is ended with
 * `taskkill /T /F`, which walks the processes by parent. The system calls are injected, so every
 * platform's branch runs in a test on any machine.
 */
import { spawnSync } from "node:child_process"
import { constants } from "node:os"

/** What signalling a tree needs from the system. */
export interface TreeSystem {
  readonly platform: NodeJS.Platform
  /** `process.kill`: throws when nothing has that pid (or group). */
  kill(pid: number, signal: NodeJS.Signals | 0): void
  /** Runs a program to completion, its output ignored. */
  runSync(command: string, args: readonly string[]): void
  /** Ends this process. */
  exit(code: number): void
}

/** This machine. */
export const SYSTEM: TreeSystem = {
  platform: process.platform,
  kill: (pid, signal) => void process.kill(pid, signal),
  runSync: (command, args) =>
    void spawnSync(command, [...args], { stdio: "ignore", windowsHide: true }),
  exit: (code) => process.exit(code),
}

/** Whether `platform` has process groups, so a child can lead one with what it starts. */
export function hasGroups(platform: NodeJS.Platform): boolean {
  return platform !== "win32"
}

/**
 * The command that ends `pid` and every process under it on Windows. `/F` because console
 * programs, a Node server among them, ignore the polite close `taskkill` sends otherwise.
 */
function treeKillCommand(pid: number): readonly [string, readonly string[]] {
  return ["taskkill", ["/T", "/F", "/PID", String(pid)]]
}

/**
 * Sends `signal` to the tree led by `pid`: its group where groups exist. On Windows any signal
 * ends the tree outright, since there is nothing gentler that a console program obeys.
 */
export function signalTree(pid: number, signal: NodeJS.Signals, system: TreeSystem = SYSTEM): void {
  try {
    if (hasGroups(system.platform)) system.kill(-pid, signal)
    else system.runSync(...treeKillCommand(pid))
  } catch {
    /* Already gone. */
  }
}

/**
 * Sends `signal` to the group `pid` leads, or to `pid` alone when it leads none, as a process
 * danwo did not start may not; on Windows its whole tree ends. Throws when nothing has that pid.
 */
export function signalLeader(
  pid: number,
  signal: NodeJS.Signals,
  system: TreeSystem = SYSTEM,
): void {
  if (!hasGroups(system.platform)) return system.runSync(...treeKillCommand(pid))

  try {
    system.kill(-pid, signal)
  } catch {
    system.kill(pid, signal)
  }
}

/**
 * Whether anything in the tree led by `pid` still runs: any process in its group, or on Windows
 * the leader itself, the only one a pid check can see.
 */
export function treeAlive(pid: number, system: TreeSystem = SYSTEM): boolean {
  try {
    system.kill(hasGroups(system.platform) ? -pid : pid, 0)

    return true
  } catch {
    return false
  }
}

/**
 * Ends this process the way `signal` would have. Windows cannot send itself a SIGHUP, and its
 * SIGINT or SIGTERM is an outright kill that skips the exit code a shell expects, so it exits with
 * `128 + n` instead.
 */
export function endBySignal(signal: NodeJS.Signals, system: TreeSystem = SYSTEM): void {
  if (hasGroups(system.platform)) system.kill(process.pid, signal)
  else system.exit(128 + constants.signals[signal])
}

/**
 * The spawn options that make a child lead its own tree: its own group where groups exist. On
 * Windows it stays on this console (detaching buys nothing `taskkill` needs, and Ctrl-C still
 * reaches it) and opens no window of its own.
 */
export function treeLeaderOptions(platform: NodeJS.Platform = process.platform): {
  readonly detached: boolean
  readonly windowsHide: true
} {
  return { detached: hasGroups(platform), windowsHide: true }
}
