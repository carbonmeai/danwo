/*
 * The flight recorder: what one test attempt or matrix run did, written under
 * `.danwo/runs/<run>/<test>/<attempt-or-fault>/` so a failure explains itself. Everything written
 * is redacted: secret values the session knew, credential headers and fields, provider key shapes.
 */
import { randomBytes } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

import type { DataCall } from "@danwo/infra"
import { dataCallsOf, deliveriesOf, type PlannedFault, type ServiceDelivery } from "@danwo/matrix"
import type { CapturedMessage, Exchange, SocketExchange } from "@danwo/proxy"

import type { LintFinding } from "../lint/index.ts"
import type { AppLogRecord, FailureEvidence, StepRecord } from "../record/index.ts"
import { type RecordedVideo, VIDEO_DIR, type VideoMode, videoMarks } from "../record/video.ts"
import { type CredentialKind, credentialKind, sentByBrowser } from "../secrets/index.ts"
import type { ReplayDivergence } from "../session.ts"
import type { TestError } from "../support/errors.ts"
import type { AttemptFlight } from "./attempt.ts"
import type { WorkerEnvironment } from "./environment.ts"
import { createRedactor, type Redactor } from "./redact.ts"
import type { FailureVerdict } from "./verdict-words.ts"
import { failureVerdict } from "./verdict.ts"

/** `always` keeps every run (the default); `on-failure` keeps failed runs only; `off` records nothing. */
export type RecordMode = "on-failure" | "always" | "off"

/** The config's `record` as an object: the mode, and how many runs keep their recordings. */
export interface RecordOptions {
  readonly mode?: RecordMode
  /**
   * How many of the newest runs keep their recordings under `.danwo/runs` (default 50); older
   * runs' records and videos are deleted when a run finishes. The run history keeps its 200.
   */
  readonly keepRuns?: number
}

/** Where one `danwo test` or `danwo matrix` invocation records, and what it keeps. */
export interface RecordSettings {
  readonly runDir: string
  readonly mode: RecordMode
  /** When a kept record keeps its video too; absent records none. */
  readonly video?: VideoMode
  /** How many of the newest runs keep their recordings; absent keeps the default. */
  readonly keepRuns?: number
}

export type RecordedStep = StepRecord & {
  /** Screenshot taken right after the step, relative to the attempt directory. */
  readonly screenshot?: string
}

export type RecordedExchange = Omit<Exchange, "request" | "response"> & {
  readonly request?: CapturedMessage
  readonly response?: CapturedMessage
  /**
   * Who sent the call: the browser (a page's own request), a server (the app's backend), or a
   * mobile app on a device (its own HTTP client).
   */
  readonly origin?: "page" | "server" | "device"
  /** The kind of credential it carried, by shape; the credential itself is redacted. */
  readonly credential?: CredentialKind
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
  /** WebSocket connections through the proxy during the run: frame counts and sizes, no frames. */
  readonly sockets?: readonly SocketExchange[]
  /** What each app the environment started wrote during the run, by app, redacted. */
  readonly processLogs?: Readonly<Record<string, readonly string[]>>
  readonly deliveries: readonly ServiceDelivery[]
  /** Statements and commands the app sent its own database and cache, through data proxies. */
  readonly dataCalls?: readonly DataCall[]
  /** Emulator state when the run ended, by service: what an invariant read from. */
  readonly state: Readonly<Record<string, unknown>>
  /** What the integration lint found in the run. */
  readonly lint?: readonly LintFinding[]
  /** Video of the run, one per tab (or the device's screen), each with the run on its clock. */
  readonly videos?: readonly RecordedVideo[]
  /** Whose failure a run that did not pass was: the app's, the test's, the environment's, danwo's. */
  readonly verdict?: FailureVerdict
}

/** The parts of a record the integration lint reads, redacted as the record keeps them. */
export type RecordEvidence = Pick<
  FlightRecord,
  "steps" | "exchanges" | "sockets" | "deliveries" | "dataCalls"
>

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
  /** Each data proxy's calls so far, in the environment's order. */
  readonly data?: readonly number[]
  /** WebSocket connections so far. */
  readonly sockets?: number
  /** Lines each app has written so far, by app. */
  readonly logs?: Readonly<Record<string, number>>
}

export function markEvidence(env: WorkerEnvironment | undefined): EvidenceMark {
  return {
    exchanges: env?.proxy?.exchanges().length ?? 0,
    deliveries: deliveriesOf(env?.webhooks).length,
    data: (env?.data ?? []).map((proxy) => proxy.calls().length),
    sockets: env?.proxy?.sockets().length ?? 0,
    logs: Object.fromEntries(
      Object.entries(env?.logs?.() ?? {}).map(([name, log]) => [name, log.written]),
    ),
  }
}

/** The lines each app wrote since `mark`, redacted; none when the environment started no app. */
function processLogsOf(input: RecordInput, redactor: Redactor): Pick<FlightRecord, "processLogs"> {
  const logs = Object.entries(input.env?.logs?.() ?? {})

  if (logs.length === 0) return {}

  return {
    processLogs: Object.fromEntries(
      logs.map(([name, log]) => {
        const dropped = log.written - log.lines.length
        const from = Math.max(0, (input.mark.logs?.[name] ?? 0) - dropped)

        return [name, log.lines.slice(from).map((line) => redactor.text(line))]
      }),
    ),
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
  /** Keep the run's video in its record; without it the record has none. */
  readonly video?: boolean
  /** Apps of the environment that stopped during the run, for its verdict. */
  readonly appsDown?: readonly string[]
  /** Routes that answered 5xx in runs that passed, which the verdict leaves out as noise. */
  readonly baseline?: ReadonlySet<string>
}

function redactorOf(input: Pick<RecordInput, "flight">): Redactor {
  return createRedactor((text) => input.flight.session.redact(text))
}

/** A run's steps, calls and deliveries, redacted as its record keeps them. */
export function recordEvidence(input: RecordInput): RecordEvidence {
  const redactor = redactorOf(input)
  const screenshots = input.flight.session.screenshots()

  return {
    steps: redactor.deep(input.flight.session.steps()).map((step) => {
      const screenshot = screenshots.get(step.index)

      return screenshot === undefined ? step : { ...step, screenshot }
    }),
    exchanges: (input.env?.proxy?.exchanges() ?? [])
      .slice(input.mark.exchanges)
      .map((exchange) => redactExchange(exchange, redactor)),
    ...socketsOf(input, redactor),
    deliveries: deliveriesOf(input.env?.webhooks).slice(input.mark.deliveries),
    ...dataEvidence(input, redactor),
  }
}

/** The run's WebSocket connections, paths redacted; none when it opened none. */
function socketsOf(input: RecordInput, redactor: Redactor): Pick<RecordEvidence, "sockets"> {
  const sockets = (input.env?.proxy?.sockets() ?? []).slice(input.mark.sockets ?? 0)

  if (sockets.length === 0) return {}

  return {
    sockets: sockets.map((socket) => ({
      ...socket,
      path: redactedPath(socket.host, socket.path, redactor),
    })),
  }
}

/** The run's data calls, when the environment has data proxies. */
function dataEvidence(input: RecordInput, redactor: Redactor): Pick<RecordEvidence, "dataCalls"> {
  if (input.env?.data === undefined) return {}

  return { dataCalls: redactor.deep(dataCallsOf(input.env.data, input.mark.data)) }
}

/** What the record adds to its evidence when the run was linted. */
export interface RecordExtras {
  /** The run's evidence when it was already gathered (for the lint), so it is not redone. */
  readonly evidence?: RecordEvidence
  readonly lint?: readonly LintFinding[]
}

/** Builds the redacted record of one run from the session's flight and the environment's evidence. */
export function buildRecord(input: RecordInput, extras: RecordExtras = {}): FlightRecord {
  const redactor = redactorOf(input)
  const evidence = extras.evidence ?? recordEvidence(input)

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
    startedAt: input.flight.startedAt,
    durationMs: input.durationMs,
    ...evidence,
    appLog: redactor.deep(input.flight.session.appLog()),
    ...processLogsOf(input, redactor),
    failure: redactor.deep(input.flight.failure),
    state: environmentState(input.env, redactor),
    ...(extras.lint !== undefined && extras.lint.length > 0 && { lint: extras.lint }),
    ...videosOf(input, evidence),
    ...verdictOf(input),
  }
}

/** A run's verdict, for one that did not pass; nothing for a run that passed or was skipped. */
export function runVerdict(input: RecordInput): FailureVerdict | undefined {
  if (input.status === "passed" || input.status === "skipped") return undefined

  return failureVerdict({
    error: input.error,
    ...(input.run.kind === "matrix" && { fault: input.run.fault?.label ?? null }),
    calls: (input.env?.proxy?.exchanges() ?? []).slice(input.mark.exchanges),
    appLog: input.flight.session.appLog(),
    steps: input.flight.session.steps(),
    ...(input.appsDown !== undefined && { appsDown: input.appsDown }),
    ...(input.baseline !== undefined && { baseline: input.baseline }),
  })
}

function verdictOf(input: RecordInput): Pick<FlightRecord, "verdict"> {
  const found = runVerdict(input)

  return found === undefined ? {} : { verdict: found }
}

/** The run's videos with its steps, calls and webhooks on their clocks, when the record keeps them. */
function videosOf(input: RecordInput, evidence: RecordEvidence): Pick<FlightRecord, "videos"> {
  const videos = input.video === true ? (input.flight.session.videos?.() ?? []) : []

  if (videos.length === 0) return {}

  return { videos: videos.map((video) => ({ ...video, marks: videoMarks(video, evidence) })) }
}

function redactMessage(message: CapturedMessage, redactor: Redactor): CapturedMessage {
  return {
    ...message,
    headers: redactor.headers(message.headers),
    body:
      message.body === null ? null : redactor.body(message.body, message.headers["content-type"]),
    ...(message.form && { form: redactor.form(message.form) }),
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

/** HTTP clients of mobile apps, by the user agent they send. */
const DEVICE_AGENT = /^(okhttp\/|Dalvik\/|CFNetwork\/)/

/** Who sent a call, from its headers. */
function originOf(headers: Readonly<Record<string, string>>): "page" | "server" | "device" {
  if (sentByBrowser(headers)) return "page"

  const agent = Object.entries(headers).find(([name]) => name.toLowerCase() === "user-agent")?.[1]

  return agent !== undefined && DEVICE_AGENT.test(agent) ? "device" : "server"
}

/** An exchange as a flight record keeps it: path, headers and bodies redacted. */
export function redactExchange(exchange: Exchange, redactor: Redactor): RecordedExchange {
  const { request, response, ...rest } = exchange
  const credential = request && credentialKind(request.headers)

  return {
    ...rest,
    path: redactedPath(rest.host, rest.path, redactor),
    ...(request && { origin: originOf(request.headers) }),
    ...(credential && { credential }),
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

    const record = build()

    /* A record that keeps no video drops what the session captured. */
    if (record.videos === undefined)
      await rm(join(dir, VIDEO_DIR), { recursive: true, force: true })
    await writeRecord(dir, record)

    return relative(process.cwd(), dir)
  } catch {
    return undefined
  }
}
