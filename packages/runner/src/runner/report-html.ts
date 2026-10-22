/*
 * The flight report's HTML: what failed and where, the screen at failure, the step timeline with
 * a screenshot per step, the app's console, calls through the proxy, webhook deliveries and the
 * emulators' state at the end. Screenshots are files beside the report; nothing loads from the
 * network.
 */
import type { ScreenshotEvent } from "../assert/screenshot.ts"
import { findingPlace } from "../lint/index.ts"
import { effectNotes, effectsOf } from "../record/effect-notes.ts"
import { modelText, recordingText } from "../record/steps.ts"
import { dollars, type Spent, tokensText, usageOf } from "../record/usage.ts"
import { afterBody, checkLine } from "./checks-text.ts"
import type { FlightRecord, RecordedExchange, RecordedStep } from "./record.ts"
import { FAVICON, LOCKUP_ON_DARK, LOCKUP_ON_LIGHT } from "./report-brand.ts"
import { testName } from "./tasks.ts"

/** One kept record, as the report reads it. */
export interface Loaded {
  readonly record: FlightRecord
  /** The record's directory relative to the run directory, with `/` separators. */
  readonly dir: string
  /** The redacted screen at failure, when one was captured. */
  readonly screen: string | undefined
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  )

function runTitle(record: FlightRecord): string {
  if (record.run.kind === "test") return `attempt ${record.run.attempt}`

  return record.run.fault?.label ?? "clean run"
}

const offset = (at: string, start: string) =>
  `+${((Date.parse(at) - Date.parse(start)) / 1000).toFixed(2)}s`

function errorBlock(record: FlightRecord): string {
  const source = record.error?.source
  const where = source
    ? ` <span class="dim">at ${escape(`${source.file}:${source.line}`)}</span>`
    : ""
  const code = record.error
    ? `<p><code>${escape(record.error.code)}</code> <span class="dim">${escape(record.error.class)}</span></p>`
    : ""
  const lines = [
    code,
    record.error && `<p class="error">${escape(record.error.message)}${where}</p>`,
    record.stopped && `<p>${escape(record.stopped)}</p>`,
    ...record.notes
      .filter((note) => note !== record.stopped)
      .map((note) => `<p class="dim">${escape(note)}</p>`),
  ]

  return lines.filter(Boolean).join("")
}

function failureBlock(loaded: Loaded): string {
  const failure = loaded.record.failure

  if (failure === undefined) return ""

  const shot = failure.screenshot
    ? `<a href="${escape(`${loaded.dir}/${failure.screenshot}`)}"><img class="failure" src="${escape(`${loaded.dir}/${failure.screenshot}`)}" alt="screen at failure"></a>`
    : ""
  const candidates = failure.candidates?.length
    ? `<p>Closest on screen:</p><pre>${escape(failure.candidates.join("\n"))}</pre>`
    : ""

  return `<h4>Screen at failure${failure.url ? ` <span class="dim">${escape(failure.url)}</span>` : ""}</h4>${shot}${candidates}${loaded.screen ? `<details><summary>Screen text</summary><pre>${escape(loaded.screen)}</pre></details>` : ""}`
}

/** An image of the attempt, linked to itself at full size. */
function picture(loaded: Loaded, path: string, alt: string, kind: string): string {
  const src = escape(`${loaded.dir}/${path}`)

  return `<figure><a href="${src}"><img class="${kind}" loading="lazy" src="${src}" alt="${escape(alt)}"></a><figcaption>${escape(alt)}</figcaption></figure>`
}

/** What screenshot checks did: a written baseline as a note, a difference as its three images. */
function screenshotNotes(step: RecordedStep, loaded: Loaded): { facts: string[]; images: string } {
  const checks = step.events.flatMap((event) => (event.kind === "screenshot" ? [event] : []))
  const facts: string[] = []
  let images = ""

  for (const check of checks) {
    if (check.outcome === "written") facts.push(`baseline written: ${check.name}`)
    if (check.outcome === "differs") images += comparison(loaded, check)
  }

  return { facts, images }
}

/** The baseline, the new picture and the diff of a screenshot check that failed, side by side. */
function comparison(loaded: Loaded, check: ScreenshotEvent): string {
  let row = picture(loaded, check.baseline, "baseline", "compare")

  if (check.actual !== undefined) row += picture(loaded, check.actual, "actual", "compare")
  if (check.diff !== undefined) row += picture(loaded, check.diff, "diff", "compare")

  return `<div class="compare">${row}</div>`
}

/** The screenshot after a step, as a thumbnail, or why the record has none. */
function stepShot(step: RecordedStep, loaded: Loaded): string {
  if (step.screenshot) {
    const src = escape(`${loaded.dir}/${step.screenshot}`)

    return `<a href="${src}"><img class="thumb" loading="lazy" src="${src}" alt="after step ${step.index}"></a>`
  }

  const missed = loaded.record.missing?.find(
    (each) => each.kind === "screenshot" && each.step === step.index,
  )

  return missed === undefined
    ? ""
    : `<span class="dim">screenshot not saved: ${escape(missed.reason)}</span>`
}

function stepRow(step: RecordedStep, loaded: Loaded): string {
  const models = step.events.filter((e) => e.kind === "model").length
  const moves = step.events.flatMap((e) =>
    e.kind === "relocated" ? [`relocated ${e.from} → ${e.to}`] : [],
  )
  const shots = screenshotNotes(step, loaded)
  const effects = effectsOf(step.events)
  const facts = [
    step.cache && cacheFact(step.cache),
    step.error && step.error.code,
    models > 0 && `${models} model call${models === 1 ? "" : "s"}`,
    ...moves,
    ...(effects === undefined ? [] : effectNotes(effects)),
    ...shots.facts,
    step.source && `${step.source.file}:${step.source.line}`,
  ].filter(Boolean)
  const shot = stepShot(step, loaded)

  return `<tr class="${step.status}"><td class="dim">${offset(step.startedAt, loaded.record.startedAt)}</td><td><code>${escape(step.api)}</code> ${escape(step.label)}${step.error ? `<div class="error">${escape(step.error.message)}</div>` : ""}<div class="dim">${escape(facts.join(" · "))}</div>${shots.images}</td><td>${escape(step.status)}</td><td class="dim">${step.durationMs} ms</td><td>${shot}</td></tr>`
}

/** How a step used the cache: the outcome, a new recording, and what made one stale. */
function cacheFact(cache: NonNullable<RecordedStep["cache"]>): string {
  const recorded = recordingText(cache)
  const saved = recorded === undefined ? "" : `, ${recorded}`
  const changed = cache.changed ? ` (${cache.changed.join(", ")} changed)` : ""
  const because = cache.because === undefined ? "" : ` (${cache.because})`
  const reason = cache.reason === undefined ? "" : `: ${cache.reason}`
  const models = modelText(cache)
  const other = models === undefined ? "" : ` (${models})`

  return `cache ${cache.mode}${because}${saved}${other}${changed}${reason}`
}

function stepsBlock(loaded: Loaded): string {
  const { steps } = loaded.record
  const body = steps.filter((step) => !afterBody(step))

  if (body.length === 0) return ""

  return `<h4>Steps</h4><table><tbody>${body.map((s) => stepRow(s, loaded)).join("")}</tbody></table>${costBlock(steps)}`
}

/** What ran after the body: the wait for background work, then the invariant's checks. */
function checksBlock(loaded: Loaded): string {
  const checks = loaded.record.steps.filter(afterBody)

  if (checks.length === 0) return ""

  const items = checks.map(
    (step) => `<li class="${escape(step.status)}">${escape(checkLine(step))}</li>`,
  )

  return `<h4>Checks</h4><ul class="checks">${items.join("")}</ul>`
}

/** One row of the cost table: which step, what it was, what it spent, how it used the cache. */
function costRow(index: string, what: string, spent: Spent, cache: string): string {
  return `<tr><td class="dim">${index}</td><td>${what}</td><td>${spent.calls}</td><td class="dim">${escape(tokensText(spent))}</td><td>${escape(dollars(spent.usd))}</td><td class="dim">${escape(cache)}</td></tr>`
}

/** What each step that called the model cost, and the total. */
function costBlock(steps: readonly RecordedStep[]): string {
  const usage = usageOf(steps)

  if (usage.spent.calls === 0) return ""

  const rows = usage.steps.map(({ step, spent }) =>
    costRow(
      `#${step.index}`,
      `<code>${escape(step.api)}</code> ${escape(step.label)}`,
      spent,
      step.cache ?? "",
    ),
  )

  return `<h4>Model use by step</h4><table><tbody>${rows.join("")}${costRow("", "total", usage.spent, "")}</tbody></table>`
}

function appLogBlock(loaded: Loaded): string {
  const log = loaded.record.appLog

  if (log.length === 0) return ""

  const rows = log
    .map(
      (l) =>
        `<tr class="${l.level}"><td class="dim">${offset(l.at, loaded.record.startedAt)}</td><td>${escape(l.level)}</td><td>${escape(l.source)}</td><td><pre>${escape(l.text)}</pre></td></tr>`,
    )
    .join("")

  return `<h4>Console and page errors</h4><table><tbody>${rows}</tbody></table>`
}

function message(title: string, m: RecordedExchange["request"]): string {
  if (m === undefined) return ""

  const headers = Object.entries(m.headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n")
  const body = m.body === null ? (m.bytes > 0 ? `(${m.bytes} bytes, not text)` : "") : m.body

  return `<p class="dim">${title}</p><pre>${escape(headers)}${body ? `\n\n${escape(body)}${m.truncated ? `\n… (${m.bytes} bytes in all)` : ""}` : ""}</pre>`
}

function exchangeItem(e: RecordedExchange, start: string): string {
  const status = e.aborted ? "aborted" : String(e.status ?? "…")
  const fault = e.fault ? ` <span class="fault">${escape(e.fault)}</span>` : ""

  return `<details><summary><span class="dim">${offset(e.startedAt, start)}</span> <code>${escape(e.method)} ${escape(e.host)}${escape(e.path)}</code> → ${escape(status)}${fault} <span class="dim">${escape(e.disposition)}</span></summary>${message("Request", e.request)}${message("Response", e.response)}</details>`
}

function exchangesBlock(loaded: Loaded): string {
  const { exchanges, startedAt } = loaded.record

  if (exchanges.length === 0) return ""

  return `<h4>Calls through the proxy</h4>${exchanges.map((e) => exchangeItem(e, startedAt)).join("")}`
}

function deliveriesBlock(loaded: Loaded): string {
  const { deliveries, startedAt } = loaded.record

  if (deliveries.length === 0) return ""

  const rows = deliveries
    .map(
      (d) =>
        `<tr><td class="dim">${offset(d.at, startedAt)}</td><td>${escape(d.service ? `${d.service} ` : "")}<code>${escape(d.topic)}</code> #${d.messageId}</td><td>attempt ${d.attempt}</td><td>${escape(String(d.status ?? d.error ?? "…"))}</td><td>${d.fault ? `<span class="fault">${escape(d.fault)}</span>` : ""}</td></tr>`,
    )
    .join("")

  return `<h4>Webhook deliveries</h4><table><tbody>${rows}</tbody></table>`
}

function dataCallsBlock(loaded: Loaded): string {
  const { dataCalls = [], startedAt } = loaded.record

  if (dataCalls.length === 0) return ""

  const rows = dataCalls
    .map(
      (c) =>
        `<tr><td class="dim">${offset(c.startedAt, startedAt)}</td><td>${escape(c.service)} <code>${escape(c.operation)}</code>${c.inTransaction ? ' <span class="dim">in transaction</span>' : ""}</td><td>${escape(c.error ?? c.outcome)}</td><td>${c.durationMs === null ? "" : `${c.durationMs} ms`}</td><td>${c.fault ? `<span class="fault">${escape(c.fault)}</span>` : ""}</td></tr>`,
    )
    .join("")

  return `<h4>Database and cache calls</h4><table><tbody>${rows}</tbody></table>`
}

function lintBlock(record: FlightRecord): string {
  const findings = record.lint ?? []

  if (findings.length === 0) return ""

  const rows = findings
    .map(
      (f) =>
        `<tr><td><span class="fault">${escape(f.severity)}</span></td><td><code>${escape(f.rule)}</code></td><td>${escape(f.message)}<br><span class="dim">${escape(findingPlace(f) || "the run")} · ${escape(f.hint)}</span></td></tr>`,
    )
    .join("")

  return `<h4>Integration lint</h4><table><tbody>${rows}</tbody></table>`
}

function stateBlock(record: FlightRecord): string {
  const services = Object.entries(record.state)

  if (services.length === 0) return ""

  return `<h4>State at the end</h4>${services.map(([name, state]) => `<details><summary>${escape(name)}</summary><pre>${escape(JSON.stringify(state, null, 2))}</pre></details>`).join("")}`
}

/** Why each video the run filmed, or meant to, is not in the record: `Video not saved: …`. */
function videoMissing(record: FlightRecord): string {
  return (record.missing ?? [])
    .filter((each) => each.kind === "video")
    .map((each) => {
      const tab = each.tab === undefined ? "" : ` (tab ${each.tab})`

      return `<p class="${each.cause === "setting" ? "dim" : "warn"}">Video not saved${tab}: ${escape(each.reason)}</p>`
    })
    .join("")
}

/** The run's video, one player per tab, when the record kept it, and why any is missing. */
function videoBlock(loaded: Loaded): string {
  const videos = loaded.record.videos ?? []

  if (videos.length === 0) return videoMissing(loaded.record)

  const players = videos.map((video) => {
    const src = escape(`${loaded.dir}/${video.file}`)

    return `<figure><video class="film" controls preload="metadata" src="${src}"></video><figcaption>${videos.length > 1 ? `Tab ${video.tab}` : "The run"}, <a href="${src}">download</a></figcaption></figure>`
  })

  return `<h4>Video</h4>${players.join("")}${videoMissing(loaded.record)}`
}

function section(loaded: Loaded): string {
  const { record } = loaded
  const failed = record.status !== "passed"

  return `<section id="${escape(loaded.dir)}" class="${failed ? "failed" : "passed"}"><h3><span class="badge">${escape(record.status)}</span> ${escape(testName({ id: record.test, browser: record.browser }))} <span class="dim">— ${escape(runTitle(record))}</span></h3><p class="dim">${escape(record.startedAt)} · ${record.durationMs} ms · <code>${escape(loaded.dir)}</code></p>${errorBlock(record)}${lintBlock(record)}${failureBlock(loaded)}${videoBlock(loaded)}${stepsBlock(loaded)}${checksBlock(loaded)}${appLogBlock(loaded)}${exchangesBlock(loaded)}${deliveriesBlock(loaded)}${dataCallsBlock(loaded)}${stateBlock(record)}</section>`
}

const STYLE = `
:root{--bg:#fff;--fg:#1a1a1a;--dim:#6b6b6b;--line:#e3e3e3;--bad:#b42318;--ok:#067647;--warn:#b54708;--code:#f5f5f5}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e8e8;--dim:#9a9a9a;--line:#2e2e2e;--bad:#f97066;--ok:#47cd89;--warn:#fdb022;--code:#1f1f1f}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}
h1{font-size:20px}h3{font-size:16px;margin:0 0 4px}h4{margin:16px 0 6px}
section{border:1px solid var(--line);border-radius:8px;padding:16px;margin:16px 0}
section.failed{border-left:4px solid var(--bad)}section.passed{border-left:4px solid var(--ok)}
.badge{text-transform:uppercase;font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid currentColor}
.failed .badge{color:var(--bad)}.passed .badge{color:var(--ok)}
.dim{color:var(--dim)}.error{color:var(--bad);white-space:pre-wrap}.fault,.warn{color:var(--warn)}
table{border-collapse:collapse;width:100%}td{border-top:1px solid var(--line);padding:4px 6px;vertical-align:top}
ul.checks{list-style:none;padding:0;margin:0}ul.checks li{border-top:1px solid var(--line);padding:4px 6px}ul.checks li.failed{color:var(--bad)}
tr.failed td,tr.error td{color:var(--bad)}tr.blocked td,tr.inconclusive td{color:var(--warn)}
pre{background:var(--code);padding:8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:4px 0}
code{background:var(--code);padding:0 3px;border-radius:3px}
img.thumb{max-width:160px;max-height:100px;border:1px solid var(--line)}video.film{max-width:100%;max-height:420px;border:1px solid var(--line)}img.failure{max-width:100%;max-height:420px;border:1px solid var(--line)}.compare{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.compare figure{margin:0}img.compare{max-width:240px;max-height:180px;border:1px solid var(--line)}
summary{cursor:pointer;padding:2px 0}
.brand{display:block;margin:8px 0 4px}.brand img{height:22px;width:auto;display:block}.brand .on-dark{display:none}
@media (prefers-color-scheme:dark){.brand .on-light{display:none}.brand .on-dark{display:block}}
`

/** The lockup at the top of the report, the on-dark one in a dark colour scheme. */
const BRAND = `<span class="brand"><img class="on-light" src="${LOCKUP_ON_LIGHT}" alt="dánwò" height="22"><img class="on-dark" src="${LOCKUP_ON_DARK}" alt="dánwò" height="22"></span>`

/** The report's HTML for `records` of the run `runId`. */
export function renderReport(runId: string, records: readonly Loaded[]): string {
  const failed = records.filter((l) => l.record.status !== "passed").length
  const index = records
    .map(
      (l) =>
        `<li><a href="#${escape(l.dir)}">${escape(l.record.status)} · ${escape(testName({ id: l.record.test, browser: l.record.browser }))} — ${escape(runTitle(l.record))}</a></li>`,
    )
    .join("")

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>danwo run ${escape(runId)}</title><link rel="icon" type="image/svg+xml" href="${FAVICON}"><style>${STYLE}</style></head><body>${BRAND}<h1>danwo run ${escape(runId)}</h1><p class="dim">${records.length} recorded run${records.length === 1 ? "" : "s"}, ${failed} not passing. Secrets and credentials are redacted.</p><ul>${index}</ul>${records.map(section).join("")}</body></html>\n`
}
