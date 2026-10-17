import type { EventRecord, Recurrence } from "./entities.ts"
import type { Occurrence } from "./outlook-formatters.ts"

/**
 * Expands a series into the occurrences that overlap a window: daily, weekly and absolute
 * monthly patterns, ending on a date, after a number of occurrences, or never. Occurrences keep
 * the series' time of day in UTC.
 */

const DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
/** A bound on how many candidate days are looked at, so a window far out stays cheap. */
const MAX_STEPS = 20_000

function dayOf(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
}

/** Whether the pattern puts an occurrence on `day` (midnight UTC), counting from `first`. */
function fallsOn(pattern: Recurrence["pattern"], first: number, day: number): boolean {
  const interval = Math.max(pattern.interval, 1)
  const days = Math.round((day - first) / DAY)
  const date = new Date(day)

  if (pattern.type === "daily") return days % interval === 0

  if (pattern.type === "weekly") {
    const weeks = Math.floor((days + new Date(first).getUTCDay()) / 7)
    const wanted = pattern.daysOfWeek ?? [WEEKDAYS[new Date(first).getUTCDay()] ?? "monday"]

    return weeks % interval === 0 && wanted.includes(WEEKDAYS[date.getUTCDay()] ?? "")
  }

  const months =
    (date.getUTCFullYear() - new Date(first).getUTCFullYear()) * 12 +
    date.getUTCMonth() -
    new Date(first).getUTCMonth()

  return (
    months % interval === 0 &&
    date.getUTCDate() === (pattern.dayOfMonth ?? new Date(first).getUTCDate())
  )
}

/** The id an occurrence gets: its series' id and the day it falls on. */
function instanceId(seriesId: string, start: string): string {
  return `${seriesId}_${start.slice(0, 10).replaceAll("-", "")}`
}

function occurrenceAt(event: EventRecord, day: number): Occurrence {
  const timeOfDay = Date.parse(event.start) - dayOf(event.start)
  const length = Date.parse(event.end) - Date.parse(event.start)
  const start = new Date(day + timeOfDay).toISOString()

  return {
    event,
    start,
    end: new Date(day + timeOfDay + length).toISOString(),
    instanceId: instanceId(event.graphId, start),
  }
}

function lastDay(range: Recurrence["range"]): number {
  return range.type === "endDate" && range.endDate ? dayOf(range.endDate) : Number.POSITIVE_INFINITY
}

/** The days a series falls on, from its first day, up to `before` and the end of its range. */
function seriesDays(recurrence: Recurrence, first: number, before: number): number[] {
  const end = Math.min(lastDay(recurrence.range), before - 1)
  const limit =
    recurrence.range.type === "numbered" ? (recurrence.range.numberOfOccurrences ?? 1) : Infinity
  const days: number[] = []

  for (let step = 0; step < MAX_STEPS && days.length < limit; step++) {
    const day = first + step * DAY

    if (day > end) break
    if (fallsOn(recurrence.pattern, first, day)) days.push(day)
  }

  return days
}

/** Every occurrence of a series that overlaps `[from, to)`. */
export function seriesOccurrences(event: EventRecord, from: number, to: number): Occurrence[] {
  const recurrence = event.recurrence

  if (!recurrence) return []

  const first = dayOf(recurrence.range.startDate || event.start)

  return seriesDays(recurrence, first, to)
    .map((day) => occurrenceAt(event, day))
    .filter((occurrence) => Date.parse(occurrence.end) > from)
}

/** A single event, or each occurrence of a series, that overlaps `[from, to)`. */
export function occurrencesIn(event: EventRecord, from: number, to: number): Occurrence[] {
  if (event.recurrence) return seriesOccurrences(event, from, to)

  const overlaps = Date.parse(event.start) < to && Date.parse(event.end) > from

  return overlaps ? [{ event, start: event.start, end: event.end }] : []
}
