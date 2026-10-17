/**
 * A job process: the MCP server forks one per job that loads the project. It takes one request
 * over IPC, runs it with the runner, streams the runner's console lines as progress, sends the
 * result and exits.
 */
import { relative } from "node:path"

import {
  catalogOf,
  loadConfig,
  type MatrixRunReport,
  type Reporter,
  runMatrix,
  runTests,
  testFilesOf,
  type TestRunReport,
} from "@danwo/runner/runner"

import { inspectPage } from "./inspect.ts"
import {
  isJobRequest,
  type Job,
  type JobMessage,
  type JobPlace,
  type JobResults,
} from "./protocol.ts"

function send(message: JobMessage): Promise<void> {
  return new Promise((resolve) => {
    if (process.send === undefined) {
      resolve()

      return
    }

    process.send(message, () => resolve())
  })
}

const line = (text: string): void => {
  void send({ type: "line", text })
}

/** The model a config names: its gateway id, or that one is set. */
function modelName(model: unknown): string | undefined {
  if (model === undefined) return undefined

  return typeof model === "string" ? model : "set"
}

async function summarizeConfig(place: JobPlace): Promise<JobResults["config"]> {
  const { config, path, root } = await loadConfig(place.cwd, place.config)

  return {
    root,
    file: path === undefined ? undefined : relative(root, path),
    testDir: config.testDir ?? ".",
    testMatch: config.testMatch ?? ["**/*.danwo.ts"],
    baseUrl: config.baseUrl,
    environment: config.environment !== undefined,
    workers: config.workers ?? 1,
    retries: config.retries ?? 0,
    model: modelName(config.model),
    secrets: Object.keys(config.secrets ?? {}),
    files: Object.keys(config.files ?? {}),
    cache: config.cache?.dir,
  }
}

async function listTests(place: JobPlace): Promise<JobResults["list"]> {
  const loaded = await loadConfig(place.cwd, place.config)
  const entries = await catalogOf(loaded, testFilesOf(loaded), undefined)
  const tests = entries.map((entry) => ({
    id: entry.id,
    file: relative(loaded.root, entry.file),
    mode: entry.mode,
    invariant: entry.invariant,
  }))

  return { root: loaded.root, tests }
}

/** The runner's options for where a job runs. */
function placed(place: JobPlace): { cwd: string; config?: string } {
  return { cwd: place.cwd, ...(place.config !== undefined && { config: place.config }) }
}

/** Keeps the one value a reporter hook hands over: the finished run's report. */
function keeper<T>(): { keep: (value: T) => Promise<void>; kept: () => T | undefined } {
  let value: T | undefined

  return {
    keep: (given) => {
      value = given

      return Promise.resolve()
    },
    kept: () => value,
  }
}

async function runTestJob(
  job: Extract<Job, { kind: "test" }>,
  place: JobPlace,
): Promise<JobResults["test"]> {
  const report = keeper<TestRunReport>()
  const reporter: Reporter = { name: "mcp", testsFinished: report.keep }
  const code = await runTests({
    ...placed(place),
    patterns: job.patterns,
    ...(job.grep !== undefined && { grep: job.grep }),
    record: job.record,
    reporters: [reporter],
    write: line,
  })

  return { code, report: report.kept() }
}

async function runMatrixJob(
  job: Extract<Job, { kind: "matrix" }>,
  place: JobPlace,
): Promise<JobResults["matrix"]> {
  const report = keeper<MatrixRunReport>()
  const reporter: Reporter = { name: "mcp", matrixFinished: report.keep }
  const { code } = await runMatrix({
    ...placed(place),
    file: job.file,
    ...(job.grep !== undefined && { grep: job.grep }),
    ...(job.faults !== undefined && { faults: job.faults }),
    reporters: [reporter],
    write: line,
  })

  return { code, report: report.kept() }
}

function run(job: Job, place: JobPlace): Promise<unknown> {
  switch (job.kind) {
    case "config":
      return summarizeConfig(place)
    case "list":
      return listTests(place)
    case "test":
      return runTestJob(job, place)
    case "matrix":
      return runMatrixJob(job, place)
    case "inspect":
      return inspectPage(job, place)
    default:
      return Promise.reject(new Error("unknown job"))
  }
}

process.once("message", (request: unknown) => {
  void (async () => {
    if (!isJobRequest(request)) {
      await send({ type: "failed", message: "not a job request" })
      process.exit(1)
    }

    try {
      await send({ type: "result", result: await run(request.job, request.place) })
      process.exit(0)
    } catch (error) {
      await send({
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    }
  })()
})
