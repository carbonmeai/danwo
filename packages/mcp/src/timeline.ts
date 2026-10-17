/**
 * A flight record as an agent reads it: what failed and where, then the steps, the console's
 * errors, the calls that failed or were faulted, the webhook deliveries and the emulators' state,
 * each cut to a size worth reading.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { FlightRecord, RecordedStep } from "@danwo/runner/runner"

import type { Project } from "./project.ts"
import { failingStep, type LoadedRecord, modelCalls, runLabel } from "./records.ts"
import { capped, clip, oneLine, section, seconds, sourceText } from "./text.ts"

type Exchange = FlightRecord["exchanges"][number]
type Delivery = FlightRecord["deliveries"][number]

const MARK: Readonly<Record<string, string>> = { passed: "✓", failed: "✗", running: "…" }

function stepLine(step: RecordedStep): string {
  const models = step.events.filter((event) => event.kind === "model").length
  const extras = [
    sourceText(step.source),
    `${step.durationMs} ms`,
    step.cache && step.cache.mode !== "off" ? `cache ${step.cache.mode}` : "",
    models > 0 ? `${models} model calls` : "",
    step.screenshot ? "screenshot" : "",
  ].filter((part) => part !== "")
  const error = step.error ? `\n      ${step.error.code}: ${oneLine(step.error.message, 300)}` : ""

  return `#${step.index} ${MARK[step.status] ?? "?"} ${oneLine(step.label, 160)} (${extras.join(", ")})${error}`
}

function exchangeLine(exchange: Exchange): string {
  const status = exchange.status ?? (exchange.aborted ? "aborted" : "no answer")
  const fault = exchange.fault === null ? "" : ` [fault: ${exchange.fault}]`
  const body = exchange.response?.body ? `\n      ${oneLine(exchange.response.body, 200)}` : ""

  return `${exchange.method} ${exchange.host}${oneLine(exchange.path, 120)} → ${status}${fault}${body}`
}

/** One webhook delivery attempt, as a line: recorded runs and live sessions show them alike. */
export function deliveryLine(
  delivery: Pick<Delivery, "topic" | "attempt" | "status" | "error" | "fault"> & {
    readonly service?: string | undefined
  },
): string {
  const service = delivery.service === undefined ? "" : `${delivery.service} `
  const outcome = delivery.status ?? delivery.error ?? "no answer"
  const fault = delivery.fault === null ? "" : ` [fault: ${delivery.fault}]`

  return `${service}${delivery.topic} attempt ${delivery.attempt} → ${outcome}${fault}`
}

/** Calls worth an agent's attention: failed, unanswered or faulted. */
function troubled(exchange: Exchange): boolean {
  return (
    exchange.fault !== null ||
    exchange.aborted ||
    exchange.status === null ||
    exchange.status >= 400
  )
}

function headerLines(loaded: LoadedRecord): string[] {
  const { record } = loaded
  const mark = record.status === "passed" ? "✓" : "✗"
  const failed = failingStep(record)
  const at = record.error?.source ? ` (at ${sourceText(record.error.source)})` : ""
  const error = record.error
    ? [`error ${record.error.code}: ${oneLine(record.error.message, 600)}${at}`]
    : []

  return [
    `${mark} ${record.test} · ${runLabel(record)} · ${record.status} · ${seconds(record.durationMs)} · ${modelCalls(record)} model calls`,
    `record: ${loaded.dir}`,
    ...error,
    ...(failed ? [`failing step: #${failed.index} ${oneLine(failed.label, 200)}`] : []),
    ...(record.stopped ? [`body stopped: ${oneLine(record.stopped, 300)}`] : []),
    ...(record.divergence
      ? [`replay diverged: ${oneLine(JSON.stringify(record.divergence), 300)}`]
      : []),
    ...record.notes.map((note) => `note: ${oneLine(note, 200)}`),
  ]
}

async function failureLines(project: Project, loaded: LoadedRecord): Promise<string[]> {
  const failure = loaded.record.failure

  if (failure === undefined) return []

  const screen =
    failure.screen === undefined
      ? undefined
      : await readFile(join(project.inside(loaded.dir), failure.screen), "utf8").catch(
          () => undefined,
        )

  return section("screen at failure:", [
    ...(failure.url ? [`url: ${failure.url}`] : []),
    ...(failure.screenshot ? ['screenshot: read_screenshot with step "failure"'] : []),
    ...(failure.candidates?.length
      ? [`nearest elements: ${failure.candidates.slice(0, 8).join(" | ")}`]
      : []),
    ...(screen === undefined ? [] : clip(screen, 1_500).split("\n")),
  ])
}

function evidenceLines(record: FlightRecord): string[] {
  const consoleErrors = record.appLog.filter((log) => log.level === "error" || log.level === "warn")
  const calls = record.exchanges.filter(troubled)
  const state = JSON.stringify(record.state)

  return [
    ...section(`steps (${record.steps.length}):`, capped(record.steps, stepLine, 8, 22)),
    ...section(
      "console errors:",
      capped(consoleErrors, (log) => `[${log.level} at #${log.step}] ${oneLine(log.text, 200)}`, 8),
    ),
    ...section(
      `failed or faulted calls (${calls.length} of ${record.exchanges.length}):`,
      capped(calls, exchangeLine, 10),
    ),
    ...section(
      `webhook deliveries (${record.deliveries.length}):`,
      capped(record.deliveries, deliveryLine, 10),
    ),
    ...(state === "{}" ? [] : [`emulator state: ${clip(state, 1_500)}`]),
  ]
}

/** The record as lines of text. */
export async function timelineOf(project: Project, loaded: LoadedRecord): Promise<string[]> {
  return [
    ...headerLines(loaded),
    ...(await failureLines(project, loaded)),
    ...evidenceLines(loaded.record),
  ]
}
