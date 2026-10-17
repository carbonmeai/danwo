import type { calendar_v3 } from "googleapis"

/**
 * Expands a recurring Calendar event into its instances, for `singleEvents=true`, `instances` and
 * free/busy. Supports `RRULE` with FREQ=DAILY, WEEKLY or MONTHLY, INTERVAL, COUNT, UNTIL and BYDAY
 * (weekday names, for weekly rules), plus `EXDATE`. Times are stepped in the event's own UTC
 * offset, so a weekly 23:00 meeting stays on its weekday whatever UTC says.
 */

type EventTime = calendar_v3.Schema$EventDateTime

const DAY_MS = 86_400_000
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const

/** The most instances one series is expanded to, as a guard for open-ended rules. */
const MAX_INSTANCES = 2500

/** How far past its first instance an open-ended series is expanded when nothing bounds it. */
const HORIZON_MS = 2 * 365 * DAY_MS

/** A point in time in the event's own offset: wall-clock milliseconds plus that offset. */
interface WallTime {
  readonly wall: number
  readonly offset: string
  readonly allDay: boolean
}

function offsetMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset)

  if (!match) return 0

  const minutes = Number(match[2]) * 60 + Number(match[3])

  return match[1] === "-" ? -minutes : minutes
}

/** The wall time of an event boundary. */
export function wallTimeOf(time: EventTime | undefined): WallTime | undefined {
  if (time?.date) return { wall: Date.parse(`${time.date}T00:00:00Z`), offset: "Z", allDay: true }
  if (!time?.dateTime) return undefined

  const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(time.dateTime)?.[1] ?? "Z"
  const instant = Date.parse(time.dateTime)

  return { wall: instant + offsetMinutes(offset) * 60_000, offset, allDay: false }
}

/** The instant a wall time stands for, in milliseconds since the epoch. */
export function instantOf(time: WallTime): number {
  return time.wall - offsetMinutes(time.offset) * 60_000
}

/** A wall time back in the API's shape, keeping the time zone the event was given. */
function eventTimeOf(time: WallTime, original: EventTime | undefined): EventTime {
  const iso = new Date(time.wall).toISOString()

  if (time.allDay) return { date: iso.slice(0, 10) }

  return {
    dateTime: `${iso.slice(0, 19)}${time.offset}`,
    ...(original?.timeZone && { timeZone: original.timeZone }),
  }
}

/** The parts of an `RRULE:` line. */
interface Rule {
  readonly freq: string
  readonly interval: number
  readonly count: number | undefined
  readonly until: number | undefined
  readonly byDay: readonly number[]
}

function untilOf(value: string | undefined): number | undefined {
  if (!value) return undefined

  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value)

  return match
    ? Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] ?? 23),
        Number(match[5] ?? 59),
        Number(match[6] ?? 59),
      )
    : undefined
}

function ruleOf(lines: readonly string[]): Rule | undefined {
  const line = lines.find((entry) => entry.toUpperCase().startsWith("RRULE:"))

  if (!line) return undefined

  const parts = new Map(
    line
      .slice(6)
      .split(";")
      .map((part): [string, string] => {
        const [name = "", value = ""] = part.split("=")

        return [name, value]
      }),
  )
  const count = parts.get("COUNT")

  return {
    freq: (parts.get("FREQ") ?? "").toUpperCase(),
    interval: Math.max(1, Number(parts.get("INTERVAL") ?? 1)),
    count: count === undefined ? undefined : Number(count),
    until: untilOf(parts.get("UNTIL")),
    byDay: (parts.get("BYDAY") ?? "")
      .split(",")
      .map((day) => WEEKDAYS.findIndex((weekday) => weekday === day.slice(-2)))
      .filter((day) => day >= 0),
  }
}

/** Excluded start instants from `EXDATE` lines. */
function exclusionsOf(lines: readonly string[]): Set<number> {
  const values = lines
    .filter((line) => line.toUpperCase().startsWith("EXDATE"))
    .flatMap((line) => (line.split(":")[1] ?? "").split(","))

  return new Set(values.map((value) => untilOf(value.trim()) ?? Number.NaN))
}

/** The wall-clock start of the `step`th period after `first`. */
function periodStart(first: number, rule: Rule, step: number): number {
  if (rule.freq === "DAILY") return first + step * rule.interval * DAY_MS
  if (rule.freq === "WEEKLY") return first + step * rule.interval * 7 * DAY_MS

  const date = new Date(first)

  date.setUTCMonth(date.getUTCMonth() + step * rule.interval)

  return date.getTime()
}

/** The starts within one period: one, or one per BYDAY weekday for weekly rules. */
function startsIn(period: number, rule: Rule): number[] {
  if (rule.freq !== "WEEKLY" || rule.byDay.length === 0) return [period]

  const weekday = new Date(period).getUTCDay()

  return rule.byDay
    .map((day) => period + ((day - weekday + 7) % 7) * DAY_MS)
    .toSorted((a, b) => a - b)
}

/** Whether the series has as many instances as its COUNT asks for, or the guard allows. */
function enough(starts: readonly number[], rule: Rule): boolean {
  return starts.length >= Math.min(rule.count ?? MAX_INSTANCES, MAX_INSTANCES)
}

/** Every start wall time of the series, from its first up to `untilWall`. */
function seriesStarts(first: WallTime, rule: Rule, untilWall: number): number[] {
  const starts: number[] = []
  const limit = Math.min(untilWall, rule.until ?? Number.POSITIVE_INFINITY)

  for (let step = 0; !enough(starts, rule); step++) {
    const period = periodStart(first.wall, rule, step)

    if (period > limit + 7 * DAY_MS) break
    starts.push(...startsIn(period, rule).filter((start) => start >= first.wall && start <= limit))
  }

  return starts.slice(0, rule.count ?? MAX_INSTANCES)
}

/** The suffix Google appends to a series' id for one instance. */
function instanceSuffix(time: WallTime): string {
  const iso = new Date(instantOf(time)).toISOString().replace(/[-:]/g, "")

  return time.allDay ? iso.slice(0, 8) : `${iso.slice(0, 15)}Z`
}

/**
 * The instances of `event` that start before `until` (milliseconds; two years past the first
 * instance by default), each with its own id, `recurringEventId` and `originalStartTime`. A
 * non-recurring event is its own only instance.
 */
export function instancesOf(
  event: calendar_v3.Schema$Event,
  until?: number,
): calendar_v3.Schema$Event[] {
  const start = wallTimeOf(event.start)
  const end = wallTimeOf(event.end)
  const rule = ruleOf(event.recurrence ?? [])

  if (!start || !end || !rule) return [event]

  const length = end.wall - start.wall
  const excluded = exclusionsOf(event.recurrence ?? [])
  const untilWall =
    until === undefined ? start.wall + HORIZON_MS : until + offsetMinutes(start.offset) * 60_000
  const { recurrence: _, ...base } = event

  return seriesStarts(start, rule, untilWall)
    .map((wall) => ({ ...start, wall }))
    .filter((time) => !excluded.has(instantOf(time)))
    .map((time) => ({
      ...base,
      id: `${event.id ?? ""}_${instanceSuffix(time)}`,
      recurringEventId: event.id ?? "",
      originalStartTime: eventTimeOf(time, event.start),
      start: eventTimeOf(time, event.start),
      end: eventTimeOf({ ...time, wall: time.wall + length }, event.end),
    }))
}
