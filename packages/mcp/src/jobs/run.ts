/**
 * Runs a job in its own process (see `protocol.ts`): forks the job process with danwo's
 * TypeScript hooks, hands it the job, forwards its progress lines, and resolves to its result.
 * Cancelling stops the job process and everything it started: the job process leads its own
 * process group, and the whole group is signalled.
 */
import { type ChildProcess, fork } from "node:child_process"

import { own } from "@danwo/runner/children"

import { isJobMessage, type Job, type JobPlace, type JobResults } from "./protocol.ts"

const CHILD_ENTRY = new URL("./child.ts", import.meta.url)
const HOOKS = [
  import.meta.resolve("@danwo/runner/strip-types"),
  import.meta.resolve("@danwo/runner/register"),
]
const KILL_GRACE_MS = 5_000
const STDERR_TAIL = 4_000

export interface JobOptions {
  /** Each line the runner printed, as it printed it. */
  readonly onLine?: (line: string) => void
  /** Stops the job when it aborts. */
  readonly signal?: AbortSignal | undefined
}

/** Signals a process's whole group: its workers, browsers and apps go with it. */
export function stopGroup(child: ChildProcess): void {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal)
    } catch {
      /* The group is already gone. */
    }
  }

  signalGroup("SIGTERM")
  setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS).unref()
}

/** Job processes still running; they lead their own groups, so the server stops them itself. */
const running = new Set<ChildProcess>()

/** Stops every job still running, e.g. when the server shuts down. */
export function stopAllJobs(): void {
  for (const child of running) stopGroup(child)
}

/**
 * Forks `entry` in the project's folder with danwo's TypeScript hooks, leading its own process
 * group so stopping it takes everything it started.
 */
export function forkInProject(entry: URL, place: JobPlace): ChildProcess {
  const child = fork(entry, [], {
    cwd: place.cwd,
    execArgv: HOOKS.flatMap((hook) => ["--import", hook]),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: true,
  })

  /* Owned by this server: its group ends with the server, however the server ends. */
  own(child)

  return child
}

function forkJob(place: JobPlace): ChildProcess {
  const child = forkInProject(CHILD_ENTRY, place)

  running.add(child)
  child.once("exit", () => running.delete(child))

  return child
}

/** The last few thousand characters the process wrote to stderr. */
export function stderrTail(child: ChildProcess): () => string {
  let tail = ""

  child.stdout?.resume()
  child.stderr?.on("data", (chunk: Buffer) => {
    tail = `${tail}${chunk.toString()}`.slice(-STDERR_TAIL)
  })

  return () => tail.trim()
}

function exitError(code: number | null, signal: string | null, stderr: string): Error {
  const detail = stderr === "" ? "" : `:\n${stderr}`

  return new Error(
    `the job process exited with ${signal ?? `code ${code}`} before it answered${detail}`,
  )
}

/** The job process's answer: its result, its failure, or its exit before either; or a cancel. */
function answerOf(child: ChildProcess, options: JobOptions): Promise<unknown> {
  const stderr = stderrTail(child)
  const { promise, resolve, reject } = Promise.withResolvers<unknown>()

  const cancel = () => {
    stopGroup(child)
    reject(new Error("cancelled"))
  }

  options.signal?.addEventListener("abort", cancel, { once: true })
  if (options.signal?.aborted) cancel()
  child.on("message", (message: unknown) => {
    if (!isJobMessage(message)) return
    if (message.type === "line") options.onLine?.(message.text)
    else if (message.type === "failed") reject(new Error(message.message))
    else resolve(message.result)
  })
  child.on("exit", (code, signal) => reject(exitError(code, signal, stderr())))

  return promise.finally(() => options.signal?.removeEventListener("abort", cancel))
}

/** Runs `job` in a fresh process and resolves to its result. */
export function runJob<K extends Job["kind"]>(
  place: JobPlace,
  job: Extract<Job, { kind: K }>,
  options: JobOptions = {},
): Promise<JobResults[K]> {
  const child = forkJob(place)
  const answer = answerOf(child, options)

  child.send({ job, place })

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the job process is danwo's own and answers each kind of job with that kind's result
  return answer as Promise<JobResults[K]>
}
