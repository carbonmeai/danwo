/**
 * The services behind a session's app, as only danwo can show them: what each emulator holds now,
 * what the app sent through the proxy and got back, and the webhooks delivered to it. Everything
 * is redacted the way the flight recorder redacts it.
 */
import { deliveriesOf, routeOf } from "@danwo/matrix"
import type { Exchange } from "@danwo/proxy"
import { environmentState, type Redactor, type WorkerEnvironment } from "@danwo/runner/runner"

import { capped, clip, oneLine } from "../text.ts"
import { deliveryLine } from "../timeline.ts"

const MAX_EXCHANGES = 40
const MAX_BODY = 600
const MAX_ROW = 300
const ROWS_SHOWN = 3
const MAX_STATE = 8_000

/** A store snapshot's collections: name and rows. */
function collectionsOf(state: unknown): [string, readonly unknown[]][] | undefined {
  if (typeof state !== "object" || state === null || !("collections" in state)) return undefined

  const { collections } = state

  if (typeof collections !== "object" || collections === null) return undefined

  return Object.entries(collections).map(([name, dump]) => [
    name,
    typeof dump === "object" && dump !== null && "rows" in dump && Array.isArray(dump.rows)
      ? dump.rows
      : [],
  ])
}

function exchangeLine(exchange: Exchange, at: number): string {
  const status = exchange.aborted ? "aborted" : (exchange.status ?? "…")
  const took = exchange.durationMs === null ? "" : ` · ${Math.round(exchange.durationMs)} ms`
  const how = exchange.disposition === "routed" ? "" : ` (${exchange.disposition})`
  const fault = exchange.fault === null ? "" : ` [fault: ${exchange.fault}]`

  return `#${at} ${routeOf(exchange)} → ${status}${took}${how}${fault}`
}

/** One emulator's state as lines: rows per collection, then the latest few rows of each. */
function serviceLines(name: string, state: unknown): string[] {
  const collections = collectionsOf(state)

  if (collections === undefined) return [`${name}:`, `  ${oneLine(JSON.stringify(state), 1_200)}`]

  const filled = collections.filter(([, rows]) => rows.length > 0)
  const counts = filled.map(([collection, rows]) => `${collection} ${rows.length}`).join(", ")

  return [
    `${name}: ${filled.length === 0 ? "empty" : counts}`,
    ...filled.flatMap(([collection, rows]) => [
      `  ${collection} (latest ${Math.min(rows.length, ROWS_SHOWN)}):`,
      ...rows.slice(-ROWS_SHOWN).map((row) => `    ${oneLine(JSON.stringify(row), MAX_ROW)}`),
    ]),
  ]
}

export class EmulatorDesk {
  private exchangeMark = 0
  private deliveryMark = 0
  private readonly env: WorkerEnvironment | undefined
  private readonly redactor: Redactor

  constructor(env: WorkerEnvironment | undefined, redactor: Redactor) {
    this.env = env
    this.redactor = redactor
  }

  /** What each emulator holds (or only `only`), redacted. */
  state(only: string | undefined): string {
    const all = environmentState(this.env, this.redactor)
    const services = Object.entries(all).filter(([name]) => only === undefined || name === only)

    if (services.length === 0)
      return only === undefined
        ? "this project's environment has no emulators"
        : `no emulator "${only}" here; there are: ${Object.keys(all).join(", ")}`

    return clip(
      services.flatMap(([name, state]) => serviceLines(name, state)).join("\n"),
      MAX_STATE,
    )
  }

  /** What went through the proxy since the last look, or since the session opened. */
  async exchanges(from: "last" | "open", bodies: boolean): Promise<string> {
    const proxy = this.env?.proxy

    if (proxy === undefined) return "this project's environment has no proxy, so no calls are seen"

    await proxy.settled(2_000).catch(() => undefined)

    const all = proxy.exchanges()
    const start = from === "open" ? 0 : this.exchangeMark
    const shown = all.slice(start).map((exchange, index) => ({ exchange, at: start + index + 1 }))

    this.exchangeMark = all.length
    if (shown.length === 0) return "no calls since the last look"

    const render = ({ exchange, at }: (typeof shown)[number]) =>
      this.exchangeText(exchange, at, bodies)

    return capped(shown, render, 5, MAX_EXCHANGES - 5).join("\n")
  }

  /** Plays pending webhook deliveries to the end, then lists the deliveries since the last look. */
  async deliver(): Promise<string> {
    if (this.env?.webhooks === undefined) return "this project's environment delivers no webhooks"

    await this.env.settle?.()

    const all = deliveriesOf(this.env.webhooks)
    const fresh = all.slice(this.deliveryMark)

    this.deliveryMark = all.length

    return fresh.length === 0
      ? "nothing was waiting to be delivered"
      : ["delivered:", ...fresh.map((delivery) => `  ${deliveryLine(delivery)}`)].join("\n")
  }

  private exchangeText(exchange: Exchange, at: number, bodies: boolean): string {
    const line = this.redactor.text(exchangeLine(exchange, at))

    if (!bodies) return line

    const part = (label: string, message: Exchange["request"]) =>
      message === undefined || message.body === null
        ? []
        : [
            `    ${label}: ${oneLine(this.redactor.body(message.body, message.headers["content-type"]), MAX_BODY)}`,
          ]

    return [line, ...part("sent", exchange.request), ...part("got", exchange.response)].join("\n")
  }
}
