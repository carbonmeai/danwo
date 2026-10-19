/**
 * Runs started from the dashboard. The server starts the danwo CLI in the project root with
 * arguments built from a checked request, one run at a time: while any run is going (from here or
 * a terminal) a new request waits in a short queue and starts when the project is free. A run
 * started here gets a process group of its own, so cancelling it stops its workers too.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"

import { getRun } from "../runs/runs-data.ts"
import { type KnownTest, type Launch, launchOf, type RunRequest } from "./launch-args.ts"
import { activeRuns, feedOfProcess, isAlive, liveRun } from "./live-data.ts"

/** Requests waiting for the project to be free, at most. */
const MAX_QUEUED = 5
/** How long a started run gets to open its live feed before its start counts as failed. */
const FEED_WAIT_MS = 30_000
/** How long the project's list of tests is trusted. */
const KNOWN_FOR_MS = 5_000
/** Lines of a run's output kept, to say why it ended before it began. */
const OUTPUT_LINES = 30

type Ready = Extract<Launch, { args: readonly string[] }>

interface Started {
  readonly child: ChildProcess
  readonly label: string
  runId: string | undefined
  readonly output: string[]
}

interface Waiting {
  readonly root: string
  readonly launch: Ready
}

let started: Started | undefined
const queue: Waiting[] = []
let pump: ReturnType<typeof setInterval> | undefined
let known: { readonly at: number; readonly tests: readonly KnownTest[] } | undefined

/** What the dashboard's runs look like now, for the runs list. */
export interface LauncherState {
  /** Whether runs can be started from here at all. */
  readonly available: boolean
  readonly started?: { readonly label: string; readonly runId?: string }
  readonly queued: readonly string[]
}

/** The danwo CLI `danwo serve` runs, when it can be found. */
function cli(): string | undefined {
  const path = process.env.DANWO_CLI_BIN

  return path !== undefined && existsSync(path) ? path : undefined
}

export function launcherState(): LauncherState {
  return {
    available: cli() !== undefined,
    ...(started && {
      started: {
        label: started.label,
        ...(started.runId !== undefined && { runId: started.runId }),
      },
    }),
    queued: queue.map((waiting) => waiting.launch.label),
  }
}

/** Runs the CLI to completion and gives back what it printed. */
function runCli(root: string, args: readonly string[]): Promise<string> {
  const bin = cli()

  if (bin === undefined) return Promise.reject(new Error("the danwo CLI was not found"))

  return new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [bin, ...args],
      { cwd: root, env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    ),
  )
}

function isKnownTest(value: unknown): value is KnownTest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "file") === "string"
  )
}

/** The tests `danwo test --list` printed, from its last line. */
export function listedTests(printed: string): KnownTest[] {
  const parsed: unknown = JSON.parse(printed.trim().split("\n").at(-1) || "[]")

  return Array.isArray(parsed) ? parsed.filter(isKnownTest) : []
}

/** The project's tests, as `danwo test --list` finds them. */
async function knownTests(root: string): Promise<readonly KnownTest[]> {
  if (known !== undefined && Date.now() - known.at < KNOWN_FOR_MS) return known.tests

  const tests = listedTests(await runCli(root, ["test", "--list"]))

  known = { at: Date.now(), tests }

  return tests
}

const FAILED = new Set(["failed", "timed-out", "interrupted"])

/** The failed test ids of test run `id`. */
async function failedTests(root: string, id: string): Promise<string[]> {
  const run = await getRun(root, id)

  if (run?.kind !== "test") return []

  return run.tests.filter((test) => FAILED.has(test.status)).map((test) => test.id)
}

/** Whether a run is going in the project, from here or anywhere else. */
async function busy(root: string): Promise<boolean> {
  return started !== undefined || (await activeRuns(root)).length > 0
}

function keepOutput(output: string[], chunk: Buffer): void {
  output.push(
    ...chunk
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== ""),
  )
  output.splice(0, Math.max(0, output.length - OUTPUT_LINES))
}

/** Starts the CLI for `launch`, in a process group of its own. */
function spawnRun(root: string, launch: Ready, bin: string): Started {
  const child = spawn(process.execPath, [bin, ...launch.args], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  })
  const run: Started = { child, label: launch.label, runId: undefined, output: [] }

  child.stdout?.on("data", (chunk: Buffer) => keepOutput(run.output, chunk))
  child.stderr?.on("data", (chunk: Buffer) => keepOutput(run.output, chunk))
  child.once("exit", () => {
    if (started === run) started = undefined
  })
  started = run
  void feedOf(root, run)

  return run
}

const ended = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null

/** Waits for the run's feed, noting its id; undefined when the run ended before it opened one. */
async function feedOf(root: string, run: Started): Promise<string | undefined> {
  const deadline = Date.now() + FEED_WAIT_MS
  const pid = run.child.pid ?? -1

  while (Date.now() < deadline && run.runId === undefined && !ended(run.child)) {
    run.runId = await feedOfProcess(root, pid)
    if (run.runId === undefined) await new Promise((resolve) => setTimeout(resolve, 200))
  }

  return run.runId
}

/** Starts the queue's next run whenever the project is free, until the queue is empty. */
function pumpQueue(): void {
  if (pump !== undefined) return

  pump = setInterval(() => {
    const next = queue[0]
    const bin = cli()

    if (next === undefined || bin === undefined) {
      clearInterval(pump)
      pump = undefined

      return
    }

    void busy(next.root).then((going) => {
      if (going || queue[0] !== next) return

      queue.shift()
      spawnRun(next.root, next.launch, bin)
    })
  }, 1_000)
}

export type StartResult =
  | { readonly started: string }
  | { readonly queued: number }
  | { readonly error: string }

/** The arguments `request` becomes, from the project's tests and the run a rerun repeats. */
async function prepare(root: string, request: RunRequest): Promise<Launch> {
  const failed = request.action === "rerun-failed" ? await failedTests(root, request.runId) : []

  return launchOf(request, await knownTests(root), failed)
}

/** Waits in line for the project to be free. */
function enqueue(root: string, launch: Ready): StartResult {
  if (queue.length >= MAX_QUEUED) return { error: `${MAX_QUEUED} runs are already waiting` }

  queue.push({ root, launch })
  pumpQueue()

  return { queued: queue.length }
}

/** Starts `launch` and waits for its feed: the id of the run it became, or why it did not. */
async function launchNow(root: string, launch: Ready, bin: string): Promise<StartResult> {
  const run = spawnRun(root, launch, bin)
  const id = await feedOf(root, run)

  return id === undefined
    ? { error: run.output.join("\n") || `${launch.label} ended before it started` }
    : { started: id }
}

/** Starts `request` now, or queues it while another run is going. */
export async function startRun(root: string, request: RunRequest): Promise<StartResult> {
  const bin = cli()

  if (bin === undefined) return { error: "danwo serve cannot find the danwo CLI to run" }

  const launch = await prepare(root, request)

  if ("error" in launch) return launch

  return (await busy(root)) ? enqueue(root, launch) : launchNow(root, launch, bin)
}

/**
 * Stops a run's process group: the run, its workers and what they started. A run started from a
 * terminal leads its own group too; when the process leads none, it alone is stopped.
 */
function stopProcess(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    process.kill(pid, "SIGTERM")
  }
}

/**
 * Stops run `id` if it is still going, wherever it was started. The process is the one its live
 * feed names, which only a danwo run writes.
 */
export async function cancelRun(
  root: string,
  id: string,
): Promise<{ readonly cancelled: boolean }> {
  const view = await liveRun(root, id)

  if (view?.state !== "running" || !isAlive(view.pid)) return { cancelled: false }

  stopProcess(view.pid)

  return { cancelled: true }
}

/** Takes the `position`th waiting run (1 is next) off the queue. */
export function dropQueued(position: number): void {
  if (position >= 1 && position <= queue.length) queue.splice(position - 1, 1)
}
