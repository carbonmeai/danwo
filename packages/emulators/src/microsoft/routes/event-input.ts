import type { DayOfWeek } from "@microsoft/microsoft-graph-types"

import type { Context } from "../../http.ts"
import type { Clock } from "../../store.ts"
import type { EventFields } from "../calendar.ts"
import type { EventRecord, Recurrence } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { asObject, flag, itemBody, type JsonObject, list, oneOf, present, text } from "../input.ts"
import { toInstant } from "../time-zones.ts"

const SHOW_AS = ["free", "tentative", "busy", "oof", "workingElsewhere", "unknown"] as const
const ATTENDEE_TYPES = ["required", "optional", "resource"] as const
const PATTERNS = ["daily", "weekly", "absoluteMonthly"] as const
const RANGES = ["endDate", "noEnd", "numbered"] as const

/** A `{ dateTime, timeZone }` as an instant and its zone, or `undefined` when absent. */
function when(value: unknown): { instant: string; zone: string } | undefined {
  const raw = asObject(value)
  const dateTime = text(raw.dateTime)

  if (!dateTime) return undefined

  const zone = text(raw.timeZone) ?? "UTC"

  return { instant: toInstant(dateTime, zone), zone }
}

function attendees(value: unknown): EventRecord["attendees"] {
  return list(value).flatMap((entry) => {
    const raw = asObject(entry)
    const email = asObject(raw.emailAddress)
    const address = text(email.address)
    const type = text(raw.type) ?? "required"

    return address
      ? [
          {
            name: text(email.name) ?? address,
            address,
            type: oneOf(ATTENDEE_TYPES, type) ?? "required",
          },
        ]
      : []
  })
}

const DAYS = new Set<string>([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
])

function weekdays(value: unknown): DayOfWeek[] {
  return list(value).filter((day): day is DayOfWeek => typeof day === "string" && DAYS.has(day))
}

function recurrencePattern(raw: JsonObject): Recurrence["pattern"] | undefined {
  const type = oneOf(PATTERNS, raw.type)

  return (
    type && {
      type,
      interval: Number(raw.interval) || 1,
      ...(Array.isArray(raw.daysOfWeek) && { daysOfWeek: weekdays(raw.daysOfWeek) }),
      ...(typeof raw.dayOfMonth === "number" && { dayOfMonth: raw.dayOfMonth }),
    }
  )
}

function recurrenceRange(raw: JsonObject): Recurrence["range"] | undefined {
  const type = oneOf(RANGES, raw.type)
  const endDate = text(raw.endDate)

  return (
    type && {
      type,
      startDate: text(raw.startDate) ?? "",
      ...(endDate && { endDate }),
      ...(typeof raw.numberOfOccurrences === "number" && {
        numberOfOccurrences: raw.numberOfOccurrences,
      }),
    }
  )
}

/** A `patternedRecurrence`, when it uses a pattern and range the emulator expands. */
function recurrence(value: unknown): Recurrence | null | undefined {
  if (value === null || value === undefined) return value

  const pattern = recurrencePattern(asObject(asObject(value).pattern))
  const range = recurrenceRange(asObject(asObject(value).range))

  return pattern && range ? { pattern, range } : undefined
}

/** The event fields a create or update request sets. */
export function eventInput(raw: JsonObject): EventFields {
  const start = when(raw.start)
  const content = itemBody(raw.body)

  return present({
    subject: text(raw.subject),
    body: content?.content,
    bodyType: content?.type,
    start: start?.instant,
    end: when(raw.end)?.instant,
    timeZone: start?.zone,
    isAllDay: flag(raw.isAllDay),
    location:
      raw.location === undefined ? undefined : (text(asObject(raw.location).displayName) ?? ""),
    attendees: raw.attendees === undefined ? undefined : attendees(raw.attendees),
    showAs: oneOf(SHOW_AS, raw.showAs),
    isCancelled: flag(raw.isCancelled),
    recurrence: recurrence(raw.recurrence),
  })
}

/** A query date-time as an instant; one without an offset is UTC. */
function queryInstant(value: string | undefined): number {
  const hasOffset = value !== undefined && /[zZ]|[+-]\d\d:?\d\d$/.test(value)

  return value ? Date.parse(hasOffset ? value : `${value}Z`) : Number.NaN
}

/** The `startDateTime`/`endDateTime` window a view asks for, or Graph's 400 without one. */
export function viewWindow(c: Context, clock: Clock): { from: number; to: number } | Response {
  const from = queryInstant(c.req.query("startDateTime") ?? c.req.query("startdatetime"))
  const to = queryInstant(c.req.query("endDateTime") ?? c.req.query("enddatetime"))

  if (Number.isNaN(from) || Number.isNaN(to))
    return graphError(c, clock, {
      status: 400,
      code: "ErrorInvalidParameter",
      message:
        "This request requires a time window specified by the query string parameters StartDateTime and EndDateTime.",
    })

  return { from, to }
}
