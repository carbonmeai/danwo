/**
 * `danwo-playwright matrix`: one Playwright test, run once clean and then once per fault planned
 * from the calls and webhooks the clean run caused. Every trial is its own `playwright test`
 * process, so each starts a fresh environment; the fixture arms the trial's fault and reports what
 * happened. A faulted trial is judged by the test's invariant (its body may well break under the
 * fault); a test without an invariant must pass its body under every fault.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import {
  checkFaultFired,
  type FaultMatrixResult,
  formatMatrix,
  type PlannedFault,
  planFaults,
  type RunOutcome,
} from "@danwo/matrix"
import { DEFAULT_WEBHOOK_FAULTS, defaultOutboundFaults, loadConfig } from "@danwo/runner/runner"

import { readOutcomes, type TestOutcome } from "./protocol.ts"
import { runPlaywright } from "./spawn.ts"

export interface PlaywrightMatrixOptions {
  /** The spec file; with `grep`, it must select exactly one test. */
  readonly spec: string
  readonly grep?: string | undefined
  /** A regular expression over planned fault labels: only the faults it matches run. */
  readonly faults?: string | undefined
  /** The Playwright config file, when it is not the default one. */
  readonly config?: string | undefined
  /** The danwo config whose `matrix` settings to use; default the nearest one. */
  readonly danwoConfig?: string | undefined
  readonly cwd?: string | undefined
  readonly write?: ((line: string) => void) | undefined
}

/** An error in one report line: its first line, plus what was expected and received. */
function firstLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim())
  const values = lines.filter((line) => /^(Expected|Received)\b/.test(line))

  return [lines[0] ?? text, ...values].join(" · ")
}

function bodyNote(outcome: TestOutcome): string[] {
  if (outcome.body === "passed" || outcome.bodyError === null) return []

  const where = outcome.line === null ? "" : ` at ${outcome.file}:${outcome.line}`

  return [`body stopped${where}: ${firstLine(outcome.bodyError)}`]
}

function invariantFailure(outcome: TestOutcome): string | null {
  const error = outcome.invariant?.error ?? null

  return error === null ? null : `invariant: ${firstLine(error)}`
}

function bodyFailure(outcome: TestOutcome): string | null {
  if (outcome.body === "passed") return null

  return firstLine(outcome.bodyError ?? outcome.body)
}

/** Turns one trial's outcome into a matrix run: the clean run needs body and invariant to hold. */
export function judgeTrial(fault: PlannedFault | null, outcome: TestOutcome): RunOutcome {
  const judgedByInvariant = fault !== null && outcome.invariant !== null
  const error = judgedByInvariant
    ? invariantFailure(outcome)
    : (bodyFailure(outcome) ?? invariantFailure(outcome))

  return checkFaultFired({
    fault,
    status: error === null ? "passed" : "failed",
    error,
    exchanges: outcome.exchanges,
    deliveries: outcome.deliveries,
    notes: judgedByInvariant ? bodyNote(outcome) : [],
    record: outcome.record ?? undefined,
  })
}

/** A trial's output folder name: its place in the run and its fault, e.g. `03-reset-on-post-…`. */
function trialFolder(fault: PlannedFault | null, index: number): string {
  const slug = (fault?.label ?? "clean run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)

  return `${String(index).padStart(2, "0")}-${slug}`
}

function environmentError(fault: PlannedFault | null, error: string): RunOutcome {
  return { fault, status: "environment-error", error, exchanges: [], deliveries: [], notes: [] }
}

/** Runs one trial in its own `playwright test` process and judges it. */
async function trial(
  options: PlaywrightMatrixOptions,
  fault: PlannedFault | null,
  index: number,
): Promise<RunOutcome> {
  const cwd = options.cwd ?? process.cwd()
  const dir = await mkdtemp(join(tmpdir(), "danwo-playwright-"))
  const outcomeFile = join(dir, "outcome.jsonl")
  const outputDir = join("test-results", "danwo-matrix", trialFolder(fault, index))

  try {
    const output = await runPlaywright({ ...options, outcomeFile, outputDir, fault: fault?.label })
    const outcomes = readOutcomes(await readFile(outcomeFile, "utf8").catch(() => ""))
    const [outcome] = outcomes

    if (outcomes.length !== 1 || outcome === undefined) {
      return environmentError(
        fault,
        `the spec ran ${outcomes.length} danwo tests; select exactly one with --grep\n${output}`,
      )
    }

    return judgeTrial(fault, {
      ...outcome,
      record: outcome.record === null ? null : relative(cwd, outcome.record),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The faults to try, from the danwo config's `matrix` settings or danwo's defaults. */
async function catalogue(options: PlaywrightMatrixOptions) {
  const { config } = await loadConfig(options.cwd ?? process.cwd(), options.danwoConfig)

  return {
    outbound: config.matrix?.outboundFaults ?? defaultOutboundFaults,
    webhook: config.matrix?.webhookFaults ?? DEFAULT_WEBHOOK_FAULTS,
  }
}

function selected(plan: readonly PlannedFault[], filter: string | undefined): PlannedFault[] {
  if (filter === undefined) return [...plan]

  const pattern = new RegExp(filter)

  return plan.filter((planned) => pattern.test(planned.label))
}

function failedAny(result: FaultMatrixResult): boolean {
  return [result.clean, ...result.runs].some((run) => run.status !== "passed")
}

/** Runs the matrix and prints its report; resolves with the exit code. */
export async function runPlaywrightMatrix(options: PlaywrightMatrixOptions): Promise<number> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))
  const clean = await trial(options, null, 0)

  if (clean.status !== "passed") {
    write(formatMatrix({ clean, runs: [] }))
    write("the clean run did not pass, so no faults were planned")

    return 1
  }

  const faults = await catalogue(options)
  const planned = planFaults(clean, faults.outbound, faults.webhook)
  const plan = selected(planned, options.faults)

  write(`clean run passed; ${plan.length} of ${planned.length} planned faults to run`)

  const runs: RunOutcome[] = []

  for (const [index, fault] of plan.entries()) runs.push(await trial(options, fault, index + 1))

  const result = { clean, runs }

  write(formatMatrix(result))

  return failedAny(result) ? 1 : 0
}
