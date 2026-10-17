import type { calendar_v3 } from "googleapis"

import type { Context } from "../../http.ts"
import { badRequest, type Caller, jsonBody, pageOf, pageSize, requireAccess } from "../api.ts"
import {
  calendarOf,
  cancelEvent,
  changeEvent,
  changeSince,
  eventOf,
  insertEvent,
  syncTokenOf,
  writableFields,
} from "../calendar.ts"
import type { GoogleRouteContext } from "../context.ts"
import type { CalendarRecord } from "../entities.ts"
import { openChannel, stopChannel } from "../push.ts"
import { instantOf, instancesOf, wallTimeOf } from "../recurrence.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"

const EVENTS = "/calendar/v3/calendars/:calendarId/events"

type Event = calendar_v3.Schema$Event

/** Parameters that cannot be combined with `syncToken`. */
const NOT_WITH_SYNC = ["timeMin", "timeMax", "q", "updatedMin", "orderBy", "iCalUID"]

/** The request's `timeMax`, if it gave one. */
function timeMaxOf(c: Context): number | undefined {
  const timeMax = Date.parse(c.req.query("timeMax") ?? "")

  return Number.isNaN(timeMax) ? undefined : timeMax
}

function boundsOf(event: Event): { readonly start: number; readonly end: number } {
  const start = wallTimeOf(event.start)
  const end = wallTimeOf(event.end)

  return {
    start: start ? instantOf(start) : Number.NaN,
    end: end ? instantOf(end) : Number.NaN,
  }
}

/** Whether an event overlaps the window given by `timeMin` and `timeMax`. */
function inWindow(event: Event, c: Context): boolean {
  const { start, end } = boundsOf(event)
  const timeMin = Date.parse(c.req.query("timeMin") ?? "")
  const timeMax = Date.parse(c.req.query("timeMax") ?? "")

  return (Number.isNaN(timeMin) || end > timeMin) && (Number.isNaN(timeMax) || start < timeMax)
}

/** Whether an event's summary, description or location contains the text query `q`. */
function matchesText(event: Event, c: Context): boolean {
  const q = c.req.query("q")?.toLowerCase()

  if (q === undefined) return true

  return [event.summary, event.description, event.location].some((text) =>
    text?.toLowerCase().includes(q),
  )
}

/** Whether an event overlaps the requested window and matches the text query. */
function matchesFilters(event: Event, c: Context): boolean {
  return inWindow(event, c) && matchesText(event, c)
}

/** Orders events by start time (needs single events) or by last update. */
function ordered(events: Event[], orderBy: string | undefined, single: boolean): Event[] {
  if (orderBy === "startTime") {
    if (!single)
      throw badRequest(
        "The requested ordering is not available for the particular query.",
        "invalid",
      )

    return events.toSorted((a, b) => boundsOf(a).start - boundsOf(b).start)
  }

  if (orderBy === "updated")
    return events.toSorted((a, b) => (a.updated ?? "").localeCompare(b.updated ?? ""))

  return events
}

/** The events a full (non-sync) list returns, expanded when `singleEvents=true`. */
function fullList(context: GoogleRouteContext, calendar: CalendarRecord, c: Context): Event[] {
  const single = c.req.query("singleEvents") === "true"
  const showDeleted = c.req.query("showDeleted") === "true"
  const until = timeMaxOf(c)
  const updatedMin = c.req.query("updatedMin")
  const events = googleStore(context.store)
    .events.findBy("calendarId", calendar.calendarId)
    .map((record) => record.event)
    .filter((event) => showDeleted || event.status !== "cancelled")
    .filter((event) => updatedMin === undefined || (event.updated ?? "") >= updatedMin)
    .flatMap((event) => (single ? instancesOf(event, until) : [event]))
    .filter((event) => matchesFilters(event, c))

  return ordered(events, c.req.query("orderBy"), single)
}

/** The events changed since a sync token was issued, cancelled ones included. */
function changedSince(context: GoogleRouteContext, calendar: CalendarRecord, c: Context): Event[] {
  if (NOT_WITH_SYNC.some((name) => c.req.query(name) !== undefined))
    throw badRequest("Sync token cannot be combined with these filters.", "invalid")

  const since = changeSince(calendar, c.req.query("syncToken") ?? "")

  return googleStore(context.store)
    .events.findBy("calendarId", calendar.calendarId)
    .filter((record) => record.changed > since)
    .toSorted((a, b) => a.changed - b.changed)
    .map((record) => record.event)
}

/** Events: list (full or incremental), get, insert, update, patch, delete, instances, watch. */
export function calendarEventRoutes(context: GoogleRouteContext): void {
  const { app } = context

  const calendarFor = (
    c: Context,
    scopes: readonly string[],
  ): { caller: Caller; calendar: CalendarRecord } => {
    const caller = requireAccess(c, context, scopes)

    return { caller, calendar: calendarOf(context, caller, c.req.param("calendarId")) }
  }

  app.get(EVENTS, (c) => {
    const { calendar } = calendarFor(c, SCOPES.calendarRead)
    const items = c.req.query("syncToken")
      ? changedSince(context, calendar, c)
      : fullList(context, calendar, c)
    const page = pageOf(items, c.req.query("pageToken"), pageSize(c, "maxResults", 250, 2500))

    return c.json({
      kind: "calendar#events",
      etag: `"${calendar.id}"`,
      summary: calendar.summary,
      updated: context.clock().toISOString(),
      timeZone: calendar.timeZone,
      accessRole: "owner",
      defaultReminders: [],
      items: page.items,
      ...(page.next
        ? { nextPageToken: page.next }
        : { nextSyncToken: syncTokenOf(context, calendar) }),
    } satisfies calendar_v3.Schema$Events)
  })

  app.post(EVENTS, async (c) => {
    const { caller, calendar } = calendarFor(c, SCOPES.calendarWrite)
    const fields = writableFields(await jsonBody(c))

    return c.json(insertEvent(context, calendar, caller.user, fields).event)
  })

  app.post(`${EVENTS}/quickAdd`, (c) => {
    const { caller, calendar } = calendarFor(c, SCOPES.calendarWrite)
    const start = new Date(context.clock().getTime() + 3_600_000)
    const end = new Date(start.getTime() + 3_600_000)
    const record = insertEvent(context, calendar, caller.user, {
      summary: c.req.query("text") ?? "",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    })

    return c.json(record.event)
  })

  app.post(`${EVENTS}/watch`, async (c) => {
    const { calendar } = calendarFor(c, SCOPES.calendarRead)
    const resourceUri = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events?alt=json`

    return c.json(
      openChannel(
        context,
        await jsonBody(c),
        { kind: "calendar", calendarId: calendar.calendarId },
        resourceUri,
      ),
    )
  })

  app.get(`${EVENTS}/:eventId`, (c) => {
    const { calendar } = calendarFor(c, SCOPES.calendarRead)

    return c.json(eventOf(context, calendar, c.req.param("eventId")).event)
  })

  app.get(`${EVENTS}/:eventId/instances`, (c) => {
    const { calendar } = calendarFor(c, SCOPES.calendarRead)
    const event = eventOf(context, calendar, c.req.param("eventId")).event
    const instances = instancesOf(event, timeMaxOf(c)).filter((instance) =>
      matchesFilters(instance, c),
    )
    const page = pageOf(instances, c.req.query("pageToken"), pageSize(c, "maxResults", 250, 2500))

    return c.json({
      kind: "calendar#events",
      summary: calendar.summary,
      timeZone: calendar.timeZone,
      accessRole: "owner",
      items: page.items,
      ...(page.next && { nextPageToken: page.next }),
    } satisfies calendar_v3.Schema$Events)
  })

  const change = (replace: boolean) => async (c: Context) => {
    const { calendar } = calendarFor(c, SCOPES.calendarWrite)
    const record = eventOf(context, calendar, c.req.param("eventId"))
    const fields = writableFields(await jsonBody(c))
    const updated = changeEvent(context, calendar, record, fields, {
      replace,
      ifMatch: c.req.header("if-match"),
    })

    return c.json(updated.event)
  }

  app.put(`${EVENTS}/:eventId`, change(true))
  app.patch(`${EVENTS}/:eventId`, change(false))

  app.delete(`${EVENTS}/:eventId`, (c) => {
    const { calendar } = calendarFor(c, SCOPES.calendarWrite)

    cancelEvent(context, calendar, eventOf(context, calendar, c.req.param("eventId")))

    return c.body(null, 204)
  })

  app.post("/calendar/v3/channels/stop", (c) => stopChannel(c, context.store))
}
