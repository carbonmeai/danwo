/*
 * The flight recorder: what one test attempt or matrix run did, written under
 * `.danwo/runs/<run>/<test>/<attempt-or-fault>/` so a failure explains itself. Everything written
 * is redacted: secret values the session knew, credential headers and fields, provider key shapes.
 */
import { randomBytes } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { deliveriesOf, type PlannedFault, type ServiceDelivery } from "@danwo/core"
import type { CapturedMessage, Exchange } from "@danwo/proxy"

import type { AppLogRecord, FailureEvidence, StepRecord } from "../record/index.ts"
import type { ReplayDivergence } from "../session.ts"
import type { TestError } from "../support/errors.ts"
import type { AttemptFlight } from "./attempt.ts"
import type { WorkerEnvironment } from "./environment.ts"
import { createRedactor, type Redactor } from "./redact.ts"

/** `on-failure` keeps failed runs only (the default); `always` keeps every run; `off` records nothing. */
export type RecordMode = "on-failure" | "always" | "off"

/** Where one `danwo test` or `danwo matrix` invocation records, and what it keeps. */
export interface RecordSettings {
  readonly runDir: string
  readonly mode: RecordMode
}

export type RecordedStep = StepRecord & {
  /** Screenshot taken right after the step, relative to the attempt directory. */
  readonly screenshot?: string
}

export type RecordedExchange = Omit<Exchange, "request" | "response"> & {
  readonly request?: CapturedMessage
  readonly response?: CapturedMessage
}

export interface FlightRecord {
  readonly version: 1
  readonly test: string
  /** Which run of the test: a `danwo test` attempt, or a matrix run with its fault (null: clean). */
  readonly run:
    | { readonly kind: "test"; readonly attempt: number }
    | { readonly kind: "matrix"; readonly fault: PlannedFault | null }
  readonly status: string
  readonly error: TestError | undefined
  /** A matrix run: where the body stopped before the invariant judged. */
  readonly stopped: string | undefined
  readonly divergence: ReplayDivergence | undefined
  readonly notes: readonly string[]
  readonly startedAt: string
  readonly durationMs: number
  readonly steps: readonly RecordedStep[]
  readonly appLog: readonly AppLogRecord[]
  readonly failure: FailureEvidence | undefined
  /** Calls through the proxy during the run, bodies capped and redacted. */
  readonly exchanges: readonly RecordedExchange[]
  readonly deliveries: readonly ServiceDelivery[]
  /** Emulator state when the run ended, by service: what an invariant read from. */
  readonly state: Readonly<Record<string, unknown>>
}

const RUNS_DIR = join(".danwo", "runs")

/** A new run directory under `root`, named so runs sort by time: `.danwo/runs/20261017-091203-ab12`. */
export function newRunDir(root: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)

  return join(root, RUNS_DIR, `${stamp}-${randomBytes(2).toString("hex")}`)
}

export function runsDir(root: string): string {
  return join(root, RUNS_DIR)
}

/** A file-name-safe slug: lower case, dashes, at most `max` characters. */
function slug(text: string, max = 60): string {
  return (
    text
      .toLowerCase()
      .replace(/\.danwo\.[mc]?[jt]s/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max)
      .replace(/-$/, "") || "run"
  )
}

/** The directory of one attempt: `<run>/<test>/<name>`. */
export function attemptDir(settings: RecordSettings, testId: string, name: string): string {
  return join(settings.runDir, slug(testId, 80), slug(name, 80))
}

/**
 * How much evidence the environment held when a run started: its calls and deliveries from there
 * on are the run's. Counted rather than timed, since emulators may deliver on a manual clock.
 */
export interface EvidenceMark {
  readonly exchanges: number
  readonly deliveries: number
}

export function markEvidence(env: WorkerEnvironment | undefined): EvidenceMark {
  return {
    exchanges: env?.proxy?.exchanges().length ?? 0,
    deliveries: deliveriesOf(env?.webhooks).length,
  }
}

/** What the worker knows about one run besides what the session saw. */
export interface RecordInput {
  readonly test: string
  readonly run: FlightRecord["run"]
  readonly status: string
  readonly error: TestError | undefined
  readonly stopped: string | undefined
  readonly divergence: ReplayDivergence | undefined
  readonly notes: readonly string[]
  readonly durationMs: number
  readonly flight: AttemptFlight
  readonly env: WorkerEnvironment | undefined
  readonly mark: EvidenceMark
}

/** Builds the redacted record of one run from the session's flight and the environment's evidence. */
export function buildRecord(input: RecordInput): FlightRecord {
  const redactor = createRedactor((text) => input.flight.session.redact(text))
  const since = input.flight.startedAt
  const screenshots = input.flight.session.screenshots()

  return {
    version: 1,
    test: input.test,
    run: input.run,
    status: input.status,
    // The session redacts what it records; the recorder redacts again before anything is written.
    error: redactor.deep(input.error),
    stopped: redactor.deep(input.stopped),
    divergence: redactor.deep(input.divergence),
    notes: input.notes.map((note) => redactor.text(note)),
    startedAt: since,
    durationMs: input.durationMs,
    steps: redactor.deep(input.flight.session.steps()).map((step) => {
      const screenshot = screenshots.get(step.index)

      return screenshot === undefined ? step : { ...step, screenshot }
    }),
    appLog: redactor.deep(input.flight.session.appLog()),
    failure: redactor.deep(input.flight.failure),
    exchanges: (input.env?.proxy?.exchanges() ?? [])
      .slice(input.mark.exchanges)
      .map((exchange) => redactExchange(exchange, redactor)),
    deliveries: deliveriesOf(input.env?.webhooks).slice(input.mark.deliveries),
    state: environmentState(input.env, redactor),
  }
}

function redactMessage(message: CapturedMessage, redactor: Redactor): CapturedMessage {
  return {
    ...message,
    headers: redactor.headers(message.headers),
    body:
      message.body === null ? null : redactor.body(message.body, message.headers["content-type"]),
  }
}

/**
 * A path redacted together with its host, so rules that need both (a Graph download link is
 * `graph.microsoft.com/download/<grant>`) apply to it.
 */
function redactedPath(host: string, path: string, redactor: Redactor): string {
  const whole = redactor.text(`${host}${path}`)

  return whole.startsWith(host) ? whole.slice(host.length) : redactor.text(path)
}

function redactExchange(exchange: Exchange, redactor: Redactor): RecordedExchange {
  const { request, response, ...rest } = exchange

  return {
    ...rest,
    path: redactedPath(rest.host, rest.path, redactor),
    ...(request && { request: redactMessage(request, redactor) }),
    ...(response && { response: redactMessage(response, redactor) }),
  }
}

interface Snapshotting {
  readonly name: string
  snapshot(): unknown
}

function isSnapshotting(value: unknown): value is Snapshotting {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "snapshot" in value &&
    typeof value.snapshot === "function"
  )
}

/** The environment's `state()`, else a snapshot of every emulator among its fixtures. */
export function environmentState(
  env: WorkerEnvironment | undefined,
  redactor: Redactor,
): Record<string, unknown> {
  try {
    const state =
      env?.state?.() ??
      Object.fromEntries(
        Object.values(env?.fixtures ?? {})
          .filter(isSnapshotting)
          .map((emulator) => [emulator.name, emulator.snapshot()]),
      )

    return Object.fromEntries(Object.entries(state).map(([key, v]) => [key, redactor.value(v)]))
  } catch (error) {
    return { error: `state unavailable: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The record's events in time order, one JSON object per line. */
function timeline(record: FlightRecord): string {
  const events = [
    ...record.steps.map((step) => ({
      at: step.startedAt,
      type: "step",
      index: step.index,
      kind: step.kind,
      api: step.api,
      label: step.label,
      status: step.status,
      durationMs: step.durationMs,
      ...(step.source && { source: step.source }),
      ...(step.cache && { cache: step.cache.mode }),
      modelCalls: step.events.filter((event) => event.kind === "model").length,
      ...(step.screenshot && { screenshot: step.screenshot }),
      ...(step.error && { error: step.error.message }),
    })),
    ...record.appLog.map((log) => ({ ...log, type: "app-log" })),
    ...record.exchanges.map(({ request: _request, response: _response, ...exchange }) => ({
      ...exchange,
      at: exchange.startedAt,
      type: "exchange",
    })),
    ...record.deliveries.map((delivery) => ({ ...delivery, type: "webhook" })),
  ]

  return events
    .toSorted((a, b) => a.at.localeCompare(b.at))
    .map((event) => JSON.stringify(event))
    .join("\n")
}

/** Writes `record.json` and `timeline.jsonl` into `dir` (the attempt's artifacts are already there). */
async function writeRecord(dir: string, record: FlightRecord): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "record.json"), `${JSON.stringify(record, null, 2)}\n`)
  await writeFile(join(dir, "timeline.jsonl"), `${timeline(record)}\n`)
}

/** Whether a run's record is kept under `mode`. */
function keeps(mode: RecordMode, failed: boolean): boolean {
  return mode === "always" || (mode === "on-failure" && failed)
}

/**
 * Records one run into `dir` if `mode` keeps it, else deletes what the run left there. Resolves
 * to the directory relative to `cwd` when kept. Never throws: the recorder must not fail a run.
 */
export async function finishRecord(
  dir: string,
  mode: RecordMode,
  failed: boolean,
  build: () => FlightRecord,
): Promise<string | undefined> {
  try {
    if (!keeps(mode, failed)) {
      await rm(dir, { recursive: true, force: true })

      return undefined
    }

    await writeRecord(dir, build())

    return relative(process.cwd(), dir)
  } catch {
    return undefined
  }
}
