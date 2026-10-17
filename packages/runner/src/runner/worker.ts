/**
 * A worker process. It loads the project's config, starts the config's environment once, and then
 * answers tasks one at a time: a test file for `danwo test`, a trial for `danwo matrix`. Tests run
 * here, so their functions never leave the process; only plain reports go back.
 */
import { basename, dirname, join } from "node:path"

import {
  applyFault,
  clearWebhookFaults,
  deliveriesOf,
  faultFired,
  type RunOutcome,
} from "@danwo/core"
import type { Proxy } from "@danwo/proxy"

import { type DeclaredTest, type FileDeclarations, suiteHooks } from "../tests/registry.ts"
import { resultOf, worthRetrying } from "../tests/retry.ts"
import { type AttemptResult, runAttempt, type ReplayUse } from "./attempt.ts"
import { loadTestFile, testIdOf } from "./catalog.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import type { WorkerEnvironment } from "./environment.ts"
import {
  attemptDir,
  buildRecord,
  type EvidenceMark,
  finishRecord,
  type FlightRecord,
  markEvidence,
  type RecordSettings,
} from "./record.ts"
import type {
  AttemptReport,
  TestFileTask,
  TestReport,
  TrialReport,
  TrialTask,
  WorkerCalls,
  WorkerStart,
} from "./tasks.ts"
import { answerCalls, sendNote } from "./wire.ts"

/** What `beforeAll` and `afterAll` receive: there is no browser session outside a test. */
const SUITE_FIXTURES = { platform: "web" }

/** The worker's project and environment, set by `start`. */
interface Bench {
  readonly loaded: LoadedConfig
  readonly env: WorkerEnvironment | undefined
  readonly workerIndex: number
  /** Undefined when the run records nothing. */
  readonly recording: RecordSettings | undefined
  readonly updateScreenshots: boolean
}

let bench: Bench | undefined

function benchOrFail(): Bench {
  if (bench === undefined) throw new Error("the worker was given a task before it started")

  return bench
}

function findDeclared(declarations: FileDeclarations, file: string, id: string): DeclaredTest {
  const root = benchOrFail().loaded.root
  const test = declarations.tests.find((candidate) => testIdOf(root, file, candidate) === id)

  if (test === undefined) throw new Error(`test not found: ${id}`)

  return test
}

/** One attempt of `id`, with its flight record directory when the run records. */
async function attemptOnce(
  declarations: FileDeclarations,
  file: string,
  id: string,
  replay: ReplayUse,
  recordAs: string,
): Promise<{ result: AttemptResult; recordDir: string | undefined; mark: EvidenceMark }> {
  const { loaded, env, recording, updateScreenshots } = benchOrFail()
  const recordDir = recording && attemptDir(recording, id, recordAs)
  const mark = markEvidence(env)
  const test = findDeclared(declarations, file, id)
  const result = await runAttempt(declarations, test, {
    id,
    config: loaded.config,
    root: loaded.root,
    env,
    replay,
    recordDir,
    screenshots: {
      dir: baselineDir(file, test.titlePath),
      update: updateScreenshots ? "all" : "missing",
    },
  })

  return { result, recordDir, mark }
}

/** A test's baselines: `__screenshots__/<file>/<test>/` next to its file. */
function baselineDir(file: string, titlePath: readonly string[]): string {
  const name = titlePath
    .join(" ")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")

  return join(dirname(file), "__screenshots__", basename(file), name || "test")
}

/** Keeps or drops a run's flight record; the directory relative to the cwd when kept. */
function keepRecord(
  recordDir: string | undefined,
  failed: boolean,
  build: () => FlightRecord,
): Promise<string | undefined> {
  const { recording } = benchOrFail()

  if (recordDir === undefined || recording === undefined) return Promise.resolve(undefined)

  return finishRecord(recordDir, recording.mode, failed, build)
}

/** A test with its retries; every retry loads the file afresh. */
async function runTest(
  task: TestFileTask,
  first: FileDeclarations,
  id: string,
): Promise<TestReport> {
  const { env, workerIndex } = benchOrFail()
  const replay: ReplayUse =
    task.cacheDir === undefined ? { kind: "none" } : { kind: "learn", dir: task.cacheDir }
  const tries = 1 + (findDeclared(first, task.file, id).options.retries ?? task.retries)
  const attempts: AttemptReport[] = []

  for (let n = 1; n <= tries; n++) {
    const declarations = n === 1 ? first : await loadTestFile(task.file)
    const { result, recordDir, mark } = await attemptOnce(
      declarations,
      task.file,
      id,
      replay,
      `attempt-${n}`,
    )
    const record = await keepRecord(recordDir, result.status !== "passed", () =>
      buildRecord({
        test: id,
        run: { kind: "test", attempt: n },
        status: result.status,
        error: result.error,
        stopped: result.stopped,
        divergence: result.divergence,
        notes: [],
        durationMs: result.durationMs,
        flight: result.flight,
        env,
        mark,
      }),
    )

    attempts.push({
      status: result.status,
      error: result.error,
      durationMs: result.durationMs,
      record,
    })

    if (!worthRetrying(result.status)) break
  }

  return { id, status: resultOf(attempts), attempts, workerIndex }
}

async function runSuiteHooks(declarations: FileDeclarations, kind: "beforeAll" | "afterAll") {
  for (const hook of suiteHooks(declarations, kind)) await hook.fn(SUITE_FIXTURES)
}

async function testFile(task: TestFileTask): Promise<TestReport[]> {
  const { loaded, workerIndex } = benchOrFail()
  const declarations = await loadTestFile(task.file)
  const selected = new Set(task.testIds)
  const reports: TestReport[] = []

  await runSuiteHooks(declarations, "beforeAll")

  for (const test of declarations.tests) {
    const id = testIdOf(loaded.root, task.file, test)

    if (!selected.has(id)) continue

    const report =
      test.mode === "skip"
        ? { id, status: "skipped" as const, attempts: [], workerIndex }
        : await runTest(task, declarations, id)

    sendNote({ topic: "tested", data: report })
    reports.push(report)
  }

  await runSuiteHooks(declarations, "afterAll")

  return reports
}

type TrialEnvironment = WorkerEnvironment & { readonly proxy: Proxy }

function hasProxy(env: WorkerEnvironment | undefined): env is TrialEnvironment {
  return env?.proxy !== undefined
}

/** The environment a trial needs: one with a proxy, since faults are injected there. */
function trialEnvironment(): TrialEnvironment {
  const { env } = benchOrFail()

  if (!hasProxy(env)) throw new Error("danwo matrix needs an environment with a proxy")

  return env
}

/** What the trial's notes start with: where its body stopped or its replay diverged. */
function stopNote(result: AttemptResult): string | undefined {
  if (result.stopped !== undefined) return result.stopped

  const divergence = result.divergence

  return (
    divergence &&
    `diverged at step ${divergence.step} (${divergence.instruction}): ${divergence.reason}`
  )
}

/**
 * What a trial reports once the app's background work settled: its verdict, and the calls and
 * deliveries from its mark on. Those the environment made
 * while resetting (an app starting up) happen before a fault is armed, so they are not the
 * test's to plan faults on.
 */
function trialReport(
  result: AttemptResult,
  env: TrialEnvironment,
  mark: EvidenceMark,
): TrialReport {
  const stop = stopNote(result)

  return {
    status: result.status === "passed" ? "passed" : "failed",
    error: result.error?.message ?? null,
    source: result.error?.source,
    // Bodies stay in the worker: the flight record has them; the run plans by route alone.
    exchanges: env.proxy
      .exchanges()
      .slice(mark.exchanges)
      .map(({ request: _q, response: _r, ...call }) => call),
    deliveries: deliveriesOf(env.webhooks).slice(mark.deliveries),
    divergence: result.divergence,
    notes: [...(stop === undefined ? [] : [stop]), ...(env.notes?.() ?? [])],
  }
}

/** A trial's record is kept when it failed, and when its fault never fired (it shows why). */
function trialNeedsRecord(report: TrialReport, fault: TrialTask["fault"]): boolean {
  const outcome: RunOutcome = { ...report, fault, error: null }

  return report.status !== "passed" || !faultFired(outcome)
}

/** Runs the trial's attempt in the reset, faulted environment and reports it. */
async function runTrial(task: TrialTask, env: TrialEnvironment): Promise<TrialReport> {
  const replay: ReplayUse = {
    kind: task.fault === null ? "learn" : "replay-only",
    dir: task.cacheDir,
  }
  const declarations = await loadTestFile(task.file)
  const { result, recordDir, mark } = await attemptOnce(
    declarations,
    task.file,
    task.testId,
    replay,
    task.fault?.label ?? "clean",
  )

  await env.settle?.()
  await env.proxy.settled().catch(() => undefined)

  const report = trialReport(result, env, mark)
  const record = await keepRecord(recordDir, trialNeedsRecord(report, task.fault), () =>
    buildRecord({
      test: task.testId,
      run: { kind: "matrix", fault: task.fault },
      status: report.status,
      error: result.error,
      stopped: result.stopped,
      divergence: result.divergence,
      notes: report.notes,
      durationMs: result.durationMs,
      flight: result.flight,
      env,
      mark,
    }),
  )

  return record === undefined ? report : { ...report, record }
}

async function trial(task: TrialTask): Promise<TrialReport> {
  const env = trialEnvironment()

  await env.reset?.()
  applyFault(env, task.fault)

  try {
    return await runTrial(task, env)
  } finally {
    env.proxy.setFault(undefined)
    clearWebhookFaults(env.webhooks)
  }
}

const calls: WorkerCalls = {
  async start(start: WorkerStart) {
    const loaded = await loadConfig(start.cwd, start.configPath)
    const env = await loaded.config.environment?.({ workerIndex: start.workerIndex })
    const recording = start.record?.mode === "off" ? undefined : start.record

    bench = {
      loaded,
      env,
      workerIndex: start.workerIndex,
      recording,
      updateScreenshots: start.updateScreenshots,
    }
  },
  testFile,
  trial,
  async stop() {
    await bench?.env?.close()
    process.disconnect?.()
    process.exit(0)
  },
}

answerCalls(calls)
