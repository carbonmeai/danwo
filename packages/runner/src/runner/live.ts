/**
 * The live feed: what a `danwo test` or `danwo matrix` run is doing while it runs, one JSON line per
 * event in `.danwo/live/<run>.jsonl`. The run appends to it and never reads it, so a run with no
 * dashboard watching pays for a few small appends and nothing else; a dashboard started mid-run
 * reads the file from the top. Everything in it is already redacted: step labels and errors come
 * from the step recorder, call paths lose their query strings, and messages pass the credential
 * redactor.
 */
import { randomBytes } from "node:crypto"
import { appendFile, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { deliveriesOf } from "@danwo/matrix"
import type { Exchange } from "@danwo/proxy"

import type { StepRecord } from "../record/index.ts"
import { stepCost } from "../record/usage.ts"
import { redactCredentials } from "../secrets/index.ts"
import type { WorkerEnvironment } from "./environment.ts"
import type { RunKind } from "./reporting.ts"

/** Live feeds kept; older ones are deleted when a run starts. */
const KEEP = 20

/** How often a running attempt looks for new calls and webhooks. */
const TAP_EVERY_MS = 400

/** A step as the feed shows it: started (`running`) or ended, with what it did and cost. */
export interface LiveStep {
  readonly index: number
  readonly kind: StepRecord["kind"]
  readonly api: string
  readonly label: string
  readonly status: StepRecord["status"]
  readonly durationMs: number
  /** What an agent step did on the page, in order. */
  readonly actions: readonly string[]
  readonly error?: string
  /** How the step used the replay cache, when it is an agent step. */
  readonly cache?: string
  /** What its model calls cost, in US dollars. */
  readonly usd: number
}

/** A provider call through the proxy, once it was answered (or refused, or aborted). */
export interface LiveCall {
  readonly id: string
  readonly method: string
  readonly host: string
  /** Without the query string. */
  readonly path: string
  readonly status: number | null
  readonly durationMs: number | null
  readonly fault: string | null
  readonly from: "browser" | "server"
}

/** A webhook delivery attempt an emulator made. */
export interface LiveDelivery {
  readonly service?: string
  readonly topic: string
  readonly attempt: number
  readonly status: number | null
  readonly delivered: boolean
  readonly fault: string | null
}

/** Where an event happened: a test's attempt (`attempt-1`), or a matrix trial (`clean`, a fault). */
interface Scope {
  readonly test: string
  readonly attempt: string
}

/** The feed's first line. */
export interface LiveRunStarted {
  readonly type: "run"
  readonly version: 1
  /** The run's id: its history summary and record folder carry the same one. */
  readonly id: string
  readonly kind: RunKind
  /** The run's process, so a reader can tell a run that died from one still going. */
  readonly pid: number
  readonly at: string
  /** What runs: how many tests, or the matrix's test. */
  readonly title: string
  /** Tests to run; for a matrix, 1 until its faults are planned. */
  readonly planned: number
}

export type LiveEvent =
  | LiveRunStarted
  | ({ readonly type: "attempt"; readonly at: string } & Scope)
  | ({ readonly type: "step"; readonly at: string; readonly step: LiveStep } & Scope)
  | ({ readonly type: "call"; readonly at: string; readonly call: LiveCall } & Scope)
  | ({ readonly type: "delivery"; readonly at: string; readonly delivery: LiveDelivery } & Scope)
  | ({
      readonly type: "attempt-end"
      readonly at: string
      readonly status: string
      readonly durationMs: number
    } & Scope)
  | {
      readonly type: "test"
      readonly at: string
      readonly test: string
      readonly status: string
      readonly durationMs: number
    }
  | { readonly type: "plan"; readonly at: string; readonly planned: number }
  | {
      readonly type: "trial"
      readonly at: string
      readonly fault: string | null
      readonly status: string
    }
  | {
      readonly type: "end"
      readonly at: string
      readonly exitCode: number
      readonly durationMs: number
    }

/** The events a worker sends: everything inside an attempt. */
export type WorkerLiveEvent = Extract<
  LiveEvent,
  { readonly type: "attempt" | "step" | "call" | "delivery" | "attempt-end" }
>

export function liveDir(root: string): string {
  return join(root, ".danwo", "live")
}

/** A new run id, sortable by time: `20261019-091203-ab12`. */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)

  return `${stamp}-${randomBytes(2).toString("hex")}`
}

/** Writes one run's feed. Writing never fails the run: an error stops the feed, quietly. */
export interface LiveFeed {
  write(event: LiveEvent): void
  /** Writes the closing line and waits for every line to land. */
  finish(exitCode: number, durationMs: number): Promise<void>
}

/** Starts the feed of run `first.id` under `root`, dropping the oldest feeds past the limit. */
export async function openLiveFeed(
  root: string,
  first: Omit<LiveRunStarted, "type" | "version" | "pid" | "at">,
): Promise<LiveFeed> {
  const dir = liveDir(root)
  const file = join(dir, `${first.id}.jsonl`)
  const opening: LiveRunStarted = {
    type: "run",
    version: 1,
    pid: process.pid,
    at: new Date().toISOString(),
    ...first,
  }

  let broken = false

  const stop = () => {
    broken = true
  }

  await mkdir(dir, { recursive: true }).catch(() => undefined)
  await prune(dir)

  let queue = writeFile(file, `${JSON.stringify(opening)}\n`).catch(stop)

  const write = (event: LiveEvent) => {
    if (broken) return

    queue = queue.then(() => appendFile(file, `${JSON.stringify(event)}\n`)).catch(stop)
  }

  return {
    write,
    async finish(exitCode, durationMs) {
      write({ type: "end", at: new Date().toISOString(), exitCode, durationMs })
      await queue
    },
  }
}

async function prune(dir: string): Promise<void> {
  const feeds = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".jsonl"))

  for (const old of feeds
    .toSorted()
    .toReversed()
    .slice(KEEP - 1))
    await rm(join(dir, old), { force: true }).catch(() => undefined)
}

/** A step as the feed shows it. */
export function liveStep(step: StepRecord): LiveStep {
  return {
    index: step.index,
    kind: step.kind,
    api: step.api,
    label: step.label,
    status: step.status,
    durationMs: step.durationMs,
    actions: step.events.flatMap((event) => (event.kind === "action" ? [event.label] : [])),
    ...(step.error && { error: `${step.error.code}: ${step.error.message.split("\n")[0] ?? ""}` }),
    ...(step.cache && { cache: step.cache.mode }),
    usd: stepCost(step).spent.usd,
  }
}

/** A finished call as the feed shows it. */
export function liveCall(exchange: Exchange): LiveCall {
  return {
    id: exchange.id,
    method: exchange.method,
    host: exchange.host,
    path: redactCredentials(exchange.path.split("?")[0] ?? ""),
    status: exchange.status,
    durationMs: exchange.durationMs,
    fault: exchange.fault,
    from: exchange.client ?? "server",
  }
}

const finished = (exchange: Exchange) => exchange.status !== null || exchange.aborted

/**
 * Inside a worker: reports one attempt as it runs. Steps arrive through `step`; calls and webhook
 * deliveries are looked for on a timer, from where the attempt's evidence began.
 */
export class LiveTap {
  private readonly scope: Scope
  private readonly send: (event: WorkerLiveEvent) => void
  private readonly env: WorkerEnvironment | undefined
  private readonly sentCalls = new Set<string>()
  private calls: number
  private deliveries: number
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    scope: Scope,
    env: WorkerEnvironment | undefined,
    from: { readonly exchanges: number; readonly deliveries: number },
    send: (event: WorkerLiveEvent) => void,
  ) {
    this.scope = scope
    this.env = env
    this.send = send
    this.calls = from.exchanges
    this.deliveries = from.deliveries
    send({ type: "attempt", at: new Date().toISOString(), ...scope })
    this.timer = setInterval(() => this.look(), TAP_EVERY_MS)
    this.timer.unref()
  }

  step(step: StepRecord): void {
    this.send({ type: "step", at: new Date().toISOString(), ...this.scope, step: liveStep(step) })
  }

  /** Stops looking for calls; the attempt is over, however it ended. */
  stop(): void {
    clearInterval(this.timer)
  }

  /** Reports what is left and the attempt's end. */
  end(status: string, durationMs: number): void {
    this.stop()
    this.look()
    this.send({
      type: "attempt-end",
      at: new Date().toISOString(),
      ...this.scope,
      status,
      durationMs,
    })
  }

  private look(): void {
    const at = new Date().toISOString()

    this.lookForCalls(at)
    this.lookForDeliveries(at)
  }

  /** Sends the calls answered since the last look; the first unanswered one is where it looks next. */
  private lookForCalls(at: string): void {
    const exchanges = this.env?.proxy?.exchanges() ?? []

    for (const exchange of exchanges.slice(this.calls)) {
      if (!finished(exchange) || this.sentCalls.has(exchange.id)) continue

      this.sentCalls.add(exchange.id)
      this.send({ type: "call", at, ...this.scope, call: liveCall(exchange) })
    }

    while (this.calls < exchanges.length && this.sentCalls.has(exchanges[this.calls]?.id ?? ""))
      this.calls++
  }

  private lookForDeliveries(at: string): void {
    const deliveries = deliveriesOf(this.env?.webhooks).slice(this.deliveries)

    this.deliveries += deliveries.length
    for (const delivery of deliveries)
      this.send({
        type: "delivery",
        at,
        ...this.scope,
        delivery: {
          ...(delivery.service !== undefined && { service: delivery.service }),
          topic: delivery.topic,
          attempt: delivery.attempt,
          status: delivery.status,
          delivered: delivery.delivered,
          fault: delivery.fault,
        },
      })
  }
}
