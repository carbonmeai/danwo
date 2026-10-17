import { randomBytes } from "node:crypto"

import type { calendar_v3 } from "googleapis"

import { badRequest, type Caller, GoogleApiError, notFound } from "./api.ts"
import type { CalendarEventRecord, CalendarRecord, GoogleUser } from "./entities.ts"
import { notifyChannels, type PushContext } from "./push.ts"
import { googleStore } from "./store.ts"

/**
 * Calendars and their events. Every change to an event takes the next value of a store-wide
 * counter; a sync token remembers the counter it was issued at, so the next incremental list
 * returns exactly the events changed since. Watching channels are told after each change.
 */

type Event = calendar_v3.Schema$Event

const COUNTER = "calendar.changes"

/** The next change number, shared by all calendars. */
function nextChange(push: PushContext): number {
  const next = (push.store.getData<number>(COUNTER) ?? 0) + 1

  push.store.setData(COUNTER, next)

  return next
}

/** An etag in Google's quoted-number shape. */
function etagOf(change: number): string {
  return `"${3_181_161_784_712_000 + change}"`
}

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv"

/** A 26-character base32hex id, the shape of Calendar event ids. */
function calendarEventId(): string {
  return [...randomBytes(26)].map((byte) => BASE32HEX[byte % 32]).join("")
}

/** The user's primary calendar, created on first use. Its id is their email. */
export function primaryCalendar(push: PushContext, user: GoogleUser): CalendarRecord {
  const calendars = googleStore(push.store).calendars

  return (
    calendars.findOneBy("calendarId", user.email) ??
    calendars.insert({
      calendarId: user.email,
      owner: user.uid,
      summary: user.email,
      description: null,
      timeZone: "UTC",
      primary: true,
      generation: 1,
    })
  )
}

/** The caller's calendar named in a path (`primary` or an id), or a 404. */
export function calendarOf(push: PushContext, caller: Caller, calendarId: string): CalendarRecord {
  const primary = primaryCalendar(push, caller.user)
  const id = calendarId === "primary" ? primary.calendarId : calendarId
  const found = googleStore(push.store).calendars.findOneBy("calendarId", id)

  if (!found || found.owner !== caller.user.uid) throw notFound("Not Found")

  return found
}

/** A stored event of `calendar`, or a 404. */
export function eventOf(
  push: PushContext,
  calendar: CalendarRecord,
  eventId: string,
): CalendarEventRecord {
  const found = googleStore(push.store)
    .events.findBy("calendarId", calendar.calendarId)
    .find((record) => record.eventId === eventId)

  if (!found) throw notFound("Not Found")

  return found
}

/** Tells every channel watching `calendar` that its events changed. */
function announce(push: PushContext, calendar: CalendarRecord): void {
  notifyChannels(
    push,
    (target) => target.kind === "calendar" && target.calendarId === calendar.calendarId,
    "exists",
  )
}

/** The fields an event request may set; the rest belong to the server. */
const SERVER_FIELDS = new Set([
  "kind",
  "etag",
  "htmlLink",
  "created",
  "updated",
  "creator",
  "organizer",
  "iCalUID",
  "sequence",
  "recurringEventId",
  "originalStartTime",
])

/** The client-settable fields of a request body. */
export function writableFields(body: Record<string, unknown>): Event {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !SERVER_FIELDS.has(key)))
}

/** An event boundary's date or date-time, if it has one. */
function timeText(time: calendar_v3.Schema$EventDateTime | undefined): string | undefined {
  return time?.dateTime ?? time?.date ?? undefined
}

/** Google's 400s for an event without a start or end, or one that ends before it starts. */
function checkTimes(event: Event): void {
  const start = timeText(event.start)
  const end = timeText(event.end)

  if (!start) throw badRequest("Missing start time.", "required")
  if (!end) throw badRequest("Missing end time.", "required")
  if (Date.parse(end) < Date.parse(start))
    throw badRequest("The specified time range is empty.", "timeRangeEmpty")
}

/** The event with its attendees defaulting to not having answered yet. */
function withResponses(event: Event): Event {
  const { attendees, ...rest } = event

  return attendees
    ? {
        ...rest,
        attendees: attendees.map((attendee) => ({ responseStatus: "needsAction", ...attendee })),
      }
    : rest
}

/** Creates an event in `calendar` from client fields, as `events.insert` does. */
export function insertEvent(
  push: PushContext,
  calendar: CalendarRecord,
  organizer: GoogleUser,
  fields: Event,
): CalendarEventRecord {
  checkTimes(fields)

  const id = fields.id ?? calendarEventId()

  if (
    googleStore(push.store)
      .events.findBy("calendarId", calendar.calendarId)
      .some((e) => e.eventId === id)
  )
    throw new GoogleApiError(409, "duplicate", "The requested identifier already exists.")

  const now = push.clock().toISOString()
  const change = nextChange(push)
  const event: Event = {
    kind: "calendar#event",
    etag: etagOf(change),
    id,
    status: "confirmed",
    htmlLink: `https://www.google.com/calendar/event?eid=${Buffer.from(`${id} ${calendar.calendarId}`).toString("base64url")}`,
    created: now,
    updated: now,
    reminders: { useDefault: true },
    eventType: "default",
    ...withResponses(fields),
    creator: { email: organizer.email, self: true },
    organizer: { email: calendar.calendarId, self: true },
    iCalUID: `${id}@google.com`,
    sequence: 0,
  }
  const record = googleStore(push.store).events.insert({
    calendarId: calendar.calendarId,
    eventId: id,
    event: Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)),
    changed: change,
  })

  announce(push, calendar)

  return record
}

/** Replaces or merges an event's client fields, after checking `If-Match`. */
export function changeEvent(
  push: PushContext,
  calendar: CalendarRecord,
  record: CalendarEventRecord,
  fields: Event,
  options: { readonly replace: boolean; readonly ifMatch: string | undefined },
): CalendarEventRecord {
  if (options.ifMatch !== undefined && options.ifMatch !== record.event.etag)
    throw new GoogleApiError(412, "conditionNotMet", "Precondition Failed")

  const kept = options.replace
    ? Object.fromEntries(Object.entries(record.event).filter(([key]) => SERVER_FIELDS.has(key)))
    : record.event
  const merged: Event = { ...kept, ...fields, id: record.eventId }

  checkTimes(merged)

  const change = nextChange(push)
  const event: Event = {
    ...withResponses(merged),
    status: merged.status ?? "confirmed",
    etag: etagOf(change),
    updated: push.clock().toISOString(),
    sequence: (record.event.sequence ?? 0) + 1,
  }
  const updated =
    googleStore(push.store).events.update(record.id, { event, changed: change }) ?? record

  announce(push, calendar)

  return updated
}

/** Cancels an event, as `events.delete` does; a second delete is 410 Gone. */
export function cancelEvent(
  push: PushContext,
  calendar: CalendarRecord,
  record: CalendarEventRecord,
): void {
  if (record.event.status === "cancelled")
    throw new GoogleApiError(410, "deleted", "Resource has been deleted")

  const change = nextChange(push)

  googleStore(push.store).events.update(record.id, {
    event: {
      ...record.event,
      status: "cancelled",
      etag: etagOf(change),
      updated: push.clock().toISOString(),
    },
    changed: change,
  })
  announce(push, calendar)
}

/** The token for syncing `calendar` from now on. */
export function syncTokenOf(push: PushContext, calendar: CalendarRecord): string {
  const change = push.store.getData<number>(COUNTER) ?? 0

  return Buffer.from(JSON.stringify([calendar.calendarId, calendar.generation, change])).toString(
    "base64url",
  )
}

/** The change number a sync token was issued at, or 410 when the token no longer works. */
export function changeSince(calendar: CalendarRecord, token: string): number {
  let parsed: unknown

  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
  } catch {
    parsed = undefined
  }

  const [calendarId, generation, change] = Array.isArray(parsed) ? parsed : []

  if (
    calendarId !== calendar.calendarId ||
    generation !== calendar.generation ||
    typeof change !== "number"
  )
    throw new GoogleApiError(
      410,
      "fullSyncRequired",
      "Sync token is no longer valid, a full sync is required.",
    )

  return change
}

/** Makes every sync token issued for `calendar` so far get 410 Gone. */
export function expireSyncTokens(push: PushContext, calendar: CalendarRecord): void {
  googleStore(push.store).calendars.update(calendar.id, { generation: calendar.generation + 1 })
}

/** A calendar as `calendars.get` returns it. */
export function calendarResource(calendar: CalendarRecord): calendar_v3.Schema$Calendar {
  return {
    kind: "calendar#calendar",
    etag: etagOf(calendar.id),
    id: calendar.calendarId,
    summary: calendar.summary,
    ...(calendar.description !== null && { description: calendar.description }),
    timeZone: calendar.timeZone,
  }
}

/** A calendar as the user's calendar list shows it. */
export function calendarListEntry(calendar: CalendarRecord): calendar_v3.Schema$CalendarListEntry {
  return {
    ...calendarResource(calendar),
    kind: "calendar#calendarListEntry",
    colorId: "14",
    backgroundColor: "#9fe1e7",
    foregroundColor: "#000000",
    selected: true,
    accessRole: "owner",
    defaultReminders: [],
    ...(calendar.primary && { primary: true }),
  }
}
