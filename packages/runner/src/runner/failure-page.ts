/**
 * A failed run as one Markdown page, for coding agents and terminals: what failed and where, the
 * steps with how each used the cache and the model, the screen at failure, the app's console
 * errors, the calls and webhooks that failed or were faulted, and what the emulators held. Built
 * from a flight record, which is redacted already; every part is size-capped so the page stays
 * cheap to read.
 */
import { findingPlace } from "../lint/index.ts"
import { effectNotes, effectsOf } from "../record/effect-notes.ts"
import { recordingText } from "../record/steps.ts"
import { dollars, stepCost } from "../record/usage.ts"
import { afterBody, checkLine } from "./checks-text.ts"
import type { FlightRecord, RecordedExchange, RecordedStep } from "./record.ts"
import { fixAdvice, VERDICT_LABELS } from "./verdict-words.ts"

/** Caps that keep a page readable in an agent's context. */
const LIMITS = {
  message: 2_000,
  screen: 4_000,
  steps: 40,
  logs: 20,
  exchanges: 20,
  body: 600,
  state: 2_000,
} as const

/** `text` cut to `max` characters, saying how much was cut. */
function clip(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… (${text.length - max} more characters)`
}

/** A table cell: one line, pipes escaped. */
function cell(text: string): string {
  return text.replaceAll("\n", " ").replaceAll("|", "\\|")
}

/** Which run of the test this was. */
function runLabel(record: FlightRecord): string {
  if (record.run.kind === "test") return `attempt ${record.run.attempt}`

  return record.run.fault === null ? "clean matrix run" : `fault: ${record.run.fault.label}`
}

function headerLines(record: FlightRecord): string[] {
  const { error } = record
  const where = error?.source ? ` at ${error.source.file}:${error.source.line}` : ""
  const kind = error ? ` · ${error.code} (${error.class})` : ""

  return [
    `# ✗ ${record.test}`,
    "",
    `${runLabel(record)} · ${record.status}${kind} · ${(record.durationMs / 1000).toFixed(1)} s`,
    "",
    ...verdictLines(record),
    ...(error
      ? [`**Error${where}:**`, "", "```text", clip(error.message, LIMITS.message), "```", ""]
      : []),
    ...(record.stopped ? [`**Body stopped:** ${record.stopped}`, ""] : []),
    ...(record.divergence
      ? [
          `**Replay diverged** at step ${record.divergence.step} (${record.divergence.instruction}): ${record.divergence.reason}`,
          "",
        ]
      : []),
    ...record.notes.map((note) => `- ${note}`),
    ...(record.notes.length > 0 ? [""] : []),
  ]
}

/** Whose failure it is, why, and what to fix: the first thing a coding agent should read. */
function verdictLines(record: FlightRecord): string[] {
  const { verdict } = record

  if (verdict === undefined) return []

  const label = VERDICT_LABELS[verdict.verdict]
  const sure = verdict.confidence === "likely" ? " (likely)" : ""

  return [`**Verdict: ${label}${sure}.** ${verdict.reason}`, "", fixAdvice(verdict), ""]
}

/** A step's cache outcome, with what made a recording stale or why it stopped matching. */
function cacheText(cache: RecordedStep["cache"]): string {
  if (cache === undefined) return ""
  if (cache.changed) return `${cache.mode} (${cache.changed.join(", ")} changed)`

  const because = cache.because === undefined ? cache.mode : `${cache.mode} (${cache.because})`
  const recorded = recordingText(cache)
  const mode = recorded === undefined ? because : `${because}, ${recorded}`

  return cache.reason === undefined ? mode : `${mode}: ${cache.reason}`
}

function stepRow(step: RecordedStep): string {
  const { spent } = stepCost(step)
  const model =
    spent.calls === 0 ? "" : `${spent.calls}${spent.usd > 0 ? ` (${dollars(spent.usd)})` : ""}`
  const cache = cacheText(step.cache)
  const source = step.source ? `${step.source.file}:${step.source.line}` : ""
  const status = step.error ? `${step.status}: ${step.error.code}` : step.status

  return `| ${step.index} | ${cell(step.label)} | ${cell(status)} | ${cell(cache)} | ${model} | ${step.durationMs} | ${source} |`
}

function stepLines(steps: readonly RecordedStep[]): string[] {
  if (steps.length === 0) return []

  const shown = steps.slice(-LIMITS.steps)
  const hidden = steps.length - shown.length

  return [
    "## Steps",
    "",
    ...(hidden > 0 ? [`(${hidden} earlier steps not shown)`, ""] : []),
    "| # | step | status | cache | model calls | ms | source |",
    "| - | ---- | ------ | ----- | ----------- | -- | ------ |",
    ...shown.map(stepRow),
    "",
  ]
}

function screenLines(screen: string | undefined, record: FlightRecord): string[] {
  const candidates = record.failure?.candidates ?? []

  return [
    ...(screen === undefined
      ? []
      : ["## Screen at failure", "", "```text", clip(screen, LIMITS.screen), "```", ""]),
    ...(candidates.length > 0
      ? ["Nearest elements:", "", ...candidates.map((candidate) => `- ${candidate}`), ""]
      : []),
  ]
}

function logLines(record: FlightRecord): string[] {
  const problems = record.appLog.filter((log) => log.level === "error" || log.level === "warn")

  if (problems.length === 0) return []

  return [
    "## Console errors and warnings",
    "",
    ...problems
      .slice(0, LIMITS.logs)
      .map((log) => `- step ${log.step} · ${log.level} · ${cell(clip(log.text, LIMITS.body))}`),
    "",
  ]
}

/** An exchange worth showing: it failed, was refused, or had a fault injected. */
function notable(exchange: RecordedExchange): boolean {
  return (
    exchange.fault !== null ||
    exchange.aborted ||
    exchange.disposition === "blocked" ||
    (exchange.status !== null && exchange.status >= 400)
  )
}

function exchangeLines(record: FlightRecord): string[] {
  const shown = record.exchanges.filter(notable)

  if (shown.length === 0)
    return [`${record.exchanges.length} calls through the proxy, none failed.`, ""]

  return [
    "## Failed or faulted calls",
    "",
    `${shown.length} of ${record.exchanges.length} calls through the proxy:`,
    "",
    ...shown
      .slice(0, LIMITS.exchanges)
      .flatMap((exchange) => [
        `- \`${exchange.method} ${exchange.host}${exchange.path}\` → ${exchange.status ?? (exchange.aborted ? "aborted" : "no response")}${exchange.fault ? ` · fault: ${exchange.fault}` : ""}${exchange.disposition === "blocked" ? " · blocked" : ""}`,
        ...(exchange.response?.body
          ? [`  - response: \`${cell(clip(exchange.response.body, LIMITS.body))}\``]
          : []),
      ]),
    "",
  ]
}

function deliveryLines(record: FlightRecord): string[] {
  if (record.deliveries.length === 0) return []

  return [
    "## Webhook deliveries",
    "",
    "| topic | attempt | status | fault |",
    "| ----- | ------- | ------ | ----- |",
    ...record.deliveries.map(
      (d) =>
        `| ${cell(`${d.service ? `${d.service}: ` : ""}${d.topic}`)} | ${d.attempt} | ${d.status ?? cell(d.error ?? "no response")} | ${d.fault ?? ""} |`,
    ),
    "",
  ]
}

function stateLines(record: FlightRecord): string[] {
  const services = Object.entries(record.state)

  if (services.length === 0) return []

  return [
    "## Emulator state at the end",
    "",
    ...services.flatMap(([service, state]) => [
      `### ${service}`,
      "",
      "```json",
      clip(JSON.stringify(state, null, 1), LIMITS.state),
      "```",
      "",
    ]),
  ]
}

/** Steps whose replay did not have its recorded effects, or compared them only in part. */
function effectSection(steps: readonly RecordedStep[]): string[] {
  const noted = steps.flatMap((step) => {
    const check = effectsOf(step.events)

    if (check === undefined || check.result === "matched") return []

    return [
      `- step ${step.index} ${cell(step.label)}`,
      ...effectNotes(check).map((l) => `  - ${l}`),
    ]
  })

  return noted.length === 0 ? [] : ["## Effects", "", ...noted, ""]
}

/** What the integration lint found in the run, worst first. */
function lintSection(record: FlightRecord): string[] {
  const findings = record.lint ?? []

  if (findings.length === 0) return []

  return [
    "## Integration lint",
    "",
    ...findings.flatMap((finding) => [
      `- **${finding.severity}** \`${finding.rule}\`: ${cell(finding.message)} (${cell(findingPlace(finding) || "the run")})`,
      `  - ${cell(finding.hint)} See \`${finding.docs}\`.`,
    ]),
    "",
  ]
}

/** What ran after the body: the wait for background work, then the invariant's checks. */
function checkSection(steps: readonly RecordedStep[]): string[] {
  return steps.length === 0
    ? []
    : ["## Checks", "", ...steps.map((step) => `- ${cell(checkLine(step))}`), ""]
}

/** The Markdown failure page of one run's record; `screen` is its screen-at-failure text. */
export function failurePage(record: FlightRecord, screen?: string): string {
  return [
    ...headerLines(record),
    ...lintSection(record),
    ...stepLines(record.steps.filter((step) => !afterBody(step))),
    ...checkSection(record.steps.filter(afterBody)),
    ...effectSection(record.steps),
    ...screenLines(screen, record),
    ...logLines(record),
    ...exchangeLines(record),
    ...deliveryLines(record),
    ...stateLines(record),
  ]
    .join("\n")
    .trimEnd()
    .concat("\n")
}
