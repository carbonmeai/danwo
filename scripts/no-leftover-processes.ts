/**
 * A test run's guard: nothing a run starts may outlive it. Every process the run starts inherits
 * `DANWO_TEST_RUN=<id>` from its environment, so the processes of this run can be told apart from
 * those of a run in another checkout. At teardown, any marked process still alive (an app, a
 * worker, a fixture server) fails the run; it is listed and then ended so it holds no port or memory.
 * Setup also ends marked processes left by an earlier run of this checkout whose runner has died.
 *
 * Windows lets no process read another's environment, so there the run's processes are the ones
 * descended from this one, found by parent ids. That misses a process whose parent has ended (its
 * line back to the run is lost), and no earlier run's leftovers can be told apart to sweep.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { descendantsOf, processRows } from "../packages/runner/src/support/process-table.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const RUN = "DANWO_TEST_RUN"
const CHECKOUT = "DANWO_TEST_CHECKOUT"
/** How long leftovers get to finish exiting before they count: owners stop children on a short grace. */
const SETTLE_MS = 8_000

/** A process and the run marker in its environment. */
interface Marked {
  readonly pid: number
  readonly run: string
  readonly checkout: string | undefined
  readonly command: string
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** `NAME=value` read out of an environment listing or a command line. */
function variable(text: string, name: string): string | undefined {
  return new RegExp(`(?:^|[\\s\\0])${name}=(\\S+?)(?=[\\s\\0]|$)`).exec(text)?.[1]
}

/**
 * Every process carrying a run marker, from `ps -E` on macOS or `/proc` on Linux. On Windows,
 * every process descended from this one, as `run`'s; without a run, none.
 */
function markedProcesses(run?: string): Marked[] {
  if (process.platform === "win32") return run === undefined ? [] : fromTree(run)

  return process.platform === "linux" ? fromProc() : fromPs()
}

/** What the listing starts on Windows, or Windows starts beside a console program: not the run's. */
const WINDOWS_ATTENDANTS = /Win32_Process|\\conhost\.exe/i

/** When the run was marked: on Windows a process this one started before then is not the run's. */
let markedAt = 0

/** This process's descendants on Windows, started since the run was marked, each as `run`'s. */
function fromTree(run: string): Marked[] {
  return descendantsOf(processRows("win32"), process.pid)
    .filter((row) => row.started >= markedAt && !WINDOWS_ATTENDANTS.test(row.command))
    .map((row) => ({ pid: row.pid, run, checkout: ROOT, command: row.command.slice(0, 200) }))
}

/** The pids of the running processes whose environment holds `name=value`. */
export function processesWith(name: string, value: string): number[] {
  if (process.platform === "win32")
    throw new Error("Windows does not let one process read another's environment")

  const environments =
    process.platform === "linux"
      ? readdirSync("/proc")
          .filter((entry) => /^\d+$/.test(entry))
          .map((entry) => {
            try {
              return [Number(entry), readFileSync(`/proc/${entry}/environ`, "utf8")] as const
            } catch {
              return [Number(entry), ""] as const
            }
          })
      : listing().map(([pid, rest]) => [pid, rest] as const)

  return environments
    .filter(([pid, env]) => pid !== process.pid && variable(env, name) === value)
    .map(([pid]) => pid)
}

/** `ps` with every process's command line and environment, as `[pid, the rest]`. */
function listing(): Array<readonly [number, string]> {
  /* Without the markers, so `ps` does not list itself. */
  const { [RUN]: _run, [CHECKOUT]: _checkout, ...env } = process.env
  const out = execFileSync("ps", ["-A", "-E", "-ww", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env,
  })

  return out.split("\n").flatMap((line) => {
    const [, pid = "", rest = ""] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? []

    return pid === "" ? [] : [[Number(pid), rest] as const]
  })
}

function fromPs(): Marked[] {
  return listing().flatMap(([pid, rest]) => {
    const run = variable(rest, RUN)

    if (run === undefined) return []

    return [
      {
        pid,
        run,
        checkout: variable(rest, CHECKOUT),
        command: rest.split(` ${RUN}=`)[0]?.slice(0, 200) ?? "",
      },
    ]
  })
}

function fromProc(): Marked[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .flatMap((entry) => {
      try {
        const env = readFileSync(`/proc/${entry}/environ`, "utf8")
        const run = variable(env, RUN)

        if (run === undefined) return []

        const command = readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ")

        return [{ pid: Number(entry), run, checkout: variable(env, CHECKOUT), command }]
      } catch {
        return []
      }
    })
}

/** The test pool's own processes: they end with the run and are not the run's leftovers. */
function isPool(process: Marked): boolean {
  return /vitest/.test(process.command)
}

function end(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* Already gone. */
    }
  }
}

/** The run that made `run`: its id starts with the pid of the runner that set it. */
function runnerAlive(run: string): boolean {
  const pid = Number(run.split("-")[0])

  return Number.isInteger(pid) && pid > 0 && alive(pid)
}

/** Ends what earlier runs of this checkout left behind when their runner died before teardown. */
function sweepDeadRuns(): void {
  end(
    markedProcesses()
      .filter((process) => process.checkout === ROOT && !runnerAlive(process.run))
      .map((process) => process.pid),
  )
}

async function leftovers(run: string): Promise<Marked[]> {
  const deadline = Date.now() + SETTLE_MS
  let left: Marked[] = []

  do {
    left = markedProcesses(run).filter((process) => process.run === run && !isPool(process))
    if (left.length === 0) return []
    await new Promise((resolve) => setTimeout(resolve, 200))
  } while (Date.now() < deadline)

  return left
}

/** Marks the run, then fails it if anything it started is still running at the end. */
export default function setup(): () => Promise<void> {
  const run = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`

  sweepDeadRuns()
  markedAt = Date.now()
  process.env[RUN] = run
  process.env[CHECKOUT] = ROOT

  return async () => {
    const left = await leftovers(run)

    if (left.length === 0) return

    end(left.map((process) => process.pid))
    throw new Error(
      `the test run left ${left.length} process(es) running; own them with spawnOwned() and stop them:\n  ${left
        .map((process) => `${process.pid} ${process.command}`)
        .join("\n  ")}`,
    )
  }
}
