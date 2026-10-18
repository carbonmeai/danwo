/**
 * Time travel: one clock for the app, the emulators and the browser. Time only moves forward, by
 * an offset ahead of real time. The app's `Date` and the page's `Date` jump; their timers keep
 * running on real time, so sockets, retries and animations still work. The emulators' manual
 * clocks run every renewal, retry and expiry that falls due on the way, in order.
 */
import type { BrowserContext } from "playwright-core"

import { DanwoError } from "../support/codes.ts"

/** How far to travel: milliseconds, or days, hours, minutes and seconds added up. */
export type Span =
  | number
  | {
      readonly days?: number | undefined
      readonly hours?: number | undefined
      readonly minutes?: number | undefined
      readonly seconds?: number | undefined
      readonly ms?: number | undefined
    }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `span` in milliseconds. */
export function spanMs(span: Span): number {
  if (typeof span === "number") return span

  return (
    (span.days ?? 0) * DAY +
    (span.hours ?? 0) * HOUR +
    (span.minutes ?? 0) * MINUTE +
    (span.seconds ?? 0) * SECOND +
    (span.ms ?? 0)
  )
}

/** `ms` in words, largest units first, e.g. `15d 2h`. */
export function describeSpan(ms: number): string {
  const parts: string[] = []
  let left = Math.round(ms)

  for (const [unit, size] of [
    ["d", DAY],
    ["h", HOUR],
    ["m", MINUTE],
    ["s", SECOND],
  ] as const) {
    const whole = Math.floor(left / size)

    if (whole > 0) parts.push(`${whole}${unit}`)
    left -= whole * size
  }

  if (left > 0 || parts.length === 0) parts.push(`${left}ms`)

  return parts.join(" ")
}

/** What moves time behind a session: the environment's services and the apps' clocks. */
export interface TimeMachine {
  /** The time the app and the emulators are at now. */
  now(): Date
  /** Moves them `ms` forward. */
  travel(ms: number): Promise<void>
}

/** What a time machine needs from a worker's environment. */
export interface TravelSource {
  readonly proxy?: { readonly clock: { offset(): number; setOffset(ms: number): Promise<void> } }
  travel?(ms: number): Promise<void>
}

/**
 * The time machine of an environment: its `travel` when it has one (which moves the apps' clocks
 * too), else the apps' clocks through its proxy, else a clock only the browser sees.
 */
export function timeMachineOf(source: TravelSource | undefined): TimeMachine {
  let local = 0
  const offset = () => source?.proxy?.clock.offset() ?? local

  return {
    now: () => new Date(Date.now() + offset()),
    async travel(ms) {
      if (source?.travel) await source.travel(ms)
      else if (source?.proxy) await source.proxy.clock.setOffset(offset() + ms)
      else local += ms
    },
  }
}

/** A session's time, as tests (`time` fixture) and the agent move it. */
export interface SessionTime {
  /** The time the app, the emulators and the page are at now. */
  now(): Date
  /**
   * Moves everything forward, e.g. `travel({ days: 15 })`: renewals, retries and expiries that
   * fall due run in order, their webhooks land, and the page's clock jumps too. Then `settle()`
   * as usual delivers anything still pending.
   */
  travel(by: Span): Promise<void>
  /** Moves everything forward to `to`; time never goes back. */
  set(to: Date | string | number): Promise<void>
}

/** What `sessionTime` records each travel with: the step recorder's `run`. */
type RunStep = (label: string, act: () => Promise<void>) => Promise<void>

/** The page's clock: shifted, never frozen, so timers on the page keep running. */
export async function showTime(context: BrowserContext, machine: TimeMachine): Promise<void> {
  if (Math.abs(machine.now().getTime() - Date.now()) > SECOND)
    await context.clock.setSystemTime(machine.now())
}

/** The session's `time`: every travel is a step, after which the page shows the new time. */
export function sessionTime(
  machine: TimeMachine,
  context: BrowserContext,
  run: RunStep,
  ready: () => Promise<void>,
): SessionTime {
  const travel = async (ms: number) => {
    if (!Number.isFinite(ms) || ms < 0)
      throw new DanwoError("CONFIG_INVALID", `time only moves forward; cannot travel ${ms} ms`)

    await run(describeSpan(ms), async () => {
      await machine.travel(ms)
      await showTime(context, machine)
      await ready()
    })
  }

  return {
    now: () => machine.now(),
    travel: (by) => travel(spanMs(by)),
    set: (to) => travel(new Date(to).getTime() - machine.now().getTime()),
  }
}
