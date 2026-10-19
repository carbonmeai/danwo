/** A grant's calendars and their events, and free/busy across grants. */
import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import { grantOf } from "../auth.ts"
import type {
  NylasCalendar,
  NylasEvent,
  NylasGrant,
  NylasParticipant,
  NylasWhen,
} from "../entities.ts"
import { grantForEmail } from "../grants.ts"
import {
  badRequest,
  bodyOf,
  hexId,
  metadataOf,
  type NylasRouteContext,
  notFound,
  one,
  page,
  people,
  requestId,
  seconds,
  text,
} from "../helpers.ts"

const GRANT = "/v3/grants/:grant"

/** An event's `when` from a request body; a span needs both ends, in order. */
function whenOf(value: unknown): NylasWhen {
  const when = asRecord(value)

  if (typeof when?.["start_time"] === "number" && typeof when["end_time"] === "number")
    return timespanOf(when, when["start_time"], when["end_time"])
  if (typeof when?.["date"] === "string") return { object: "date", date: when["date"] }
  if (typeof when?.["start_date"] === "string" && typeof when["end_date"] === "string")
    return { object: "datespan", start_date: when["start_date"], end_date: when["end_date"] }

  throw badRequest("when must have start_time and end_time, a date, or start_date and end_date")
}

/** A span of time, in order, with the time zones the body gave. */
function timespanOf(
  when: Readonly<Record<string, unknown>>,
  start: number,
  end: number,
): NylasWhen {
  if (end <= start) throw badRequest("when.end_time must be after when.start_time")

  const zone = (key: string) => (typeof when[key] === "string" ? { [key]: when[key] } : {})

  return {
    object: "timespan",
    start_time: start,
    end_time: end,
    ...zone("start_timezone"),
    ...zone("end_timezone"),
  }
}

/** Where an event's span starts and ends, in Unix seconds; whole days count from midnight UTC. */
function spanOf(when: NylasWhen): { start: number; end: number } {
  if (when.object === "timespan") return { start: when.start_time, end: when.end_time }

  const first = when.object === "date" ? when.date : when.start_date
  const last = when.object === "date" ? when.date : when.end_date
  const start = Date.parse(`${first}T00:00:00Z`) / 1000

  return { start, end: Date.parse(`${last}T00:00:00Z`) / 1000 + 86_400 }
}

function participantsOf(value: unknown): NylasParticipant[] {
  return people(value).map((person) => ({ ...person, status: "noreply" as const }))
}

function calendarOf(context: NylasRouteContext, grant: NylasGrant, id: string): NylasCalendar {
  const calendar = context.objects.calendars.where(
    (cal) => cal.grant_id === grant.id && (cal.id === id || (id === "primary" && cal.is_primary)),
  )[0]

  if (!calendar) throw notFound(`calendar ${id}`)

  return calendar
}

/** The calendar a call's `calendar_id` query names, which events calls need. */
function queriedCalendar(context: NylasRouteContext, c: Context, grant: NylasGrant): NylasCalendar {
  const id = c.req.query("calendar_id")

  if (id === undefined) throw badRequest("calendar_id is required")

  return calendarOf(context, grant, id)
}

/** Builds a new event on `calendar` from a create body. */
export function newEvent(
  context: NylasRouteContext,
  grant: NylasGrant,
  calendar: NylasCalendar,
  body: Readonly<Record<string, unknown>>,
): NylasEvent {
  const id = hexId()
  const now = seconds(context.clock)
  const conferencing = asRecord(body["conferencing"])

  return {
    id,
    grant_id: grant.id,
    calendar_id: calendar.id,
    object: "event",
    title: text(body, "title") ?? "",
    description: text(body, "description") ?? null,
    location: text(body, "location") ?? null,
    when: whenOf(body["when"]),
    participants: participantsOf(body["participants"]),
    organizer: { email: grant.email, ...(grant.name && { name: grant.name }) },
    busy: body["busy"] !== false,
    status: "confirmed",
    visibility: body["visibility"] === "private" ? "private" : "default",
    ...(conferencing && { conferencing }),
    ...(Array.isArray(body["recurrence"]) && {
      recurrence: body["recurrence"].filter((rule): rule is string => typeof rule === "string"),
    }),
    metadata: metadataOf(body["metadata"]),
    html_link: `https://calendar.danwo.test/event?eid=${id}`,
    read_only: false,
    hide_participants: body["hide_participants"] === true,
    ical_uid: `${id}@danwo.test`,
    created_at: now,
    updated_at: now,
  }
}

/** The fields an event update may change. */
function eventChanges(body: Readonly<Record<string, unknown>>): Partial<NylasEvent> {
  const title = text(body, "title")
  const description = text(body, "description")
  const location = text(body, "location")

  return {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(location !== undefined && { location }),
    ...(body["when"] !== undefined && { when: whenOf(body["when"]) }),
    ...(body["participants"] !== undefined && {
      participants: participantsOf(body["participants"]),
    }),
    ...(typeof body["busy"] === "boolean" && { busy: body["busy"] }),
    ...(body["metadata"] !== undefined && { metadata: metadataOf(body["metadata"]) }),
  }
}

function calendarRoutes(context: NylasRouteContext): void {
  const { app, objects, events } = context

  app.get(`${GRANT}/calendars`, (c) => {
    const grant = grantOf(context, c)

    return page(
      c,
      objects.calendars.where((cal) => cal.grant_id === grant.id),
    )
  })
  app.get(`${GRANT}/calendars/:id`, (c) => {
    const grant = grantOf(context, c)

    return one(c, calendarOf(context, grant, c.req.param("id")))
  })
  app.post(`${GRANT}/calendars`, async (c) => {
    const grant = grantOf(context, c)
    const body = await bodyOf(c)
    const calendar: NylasCalendar = {
      id: `cal_${hexId()}`,
      grant_id: grant.id,
      object: "calendar",
      name: text(body, "name") ?? "Untitled",
      description: text(body, "description") ?? null,
      location: text(body, "location") ?? null,
      timezone: text(body, "timezone") ?? "UTC",
      is_primary: false,
      is_owned_by_user: true,
      read_only: false,
      hex_color: "#7986cb",
      metadata: metadataOf(body["metadata"]),
    }

    objects.calendars.add(calendar, null)
    events.emit("calendar.created", grant, calendar)

    return one(c, calendar)
  })
  app.delete(`${GRANT}/calendars/:id`, (c) => {
    const grant = grantOf(context, c)
    const calendar = calendarOf(context, grant, c.req.param("id"))

    if (calendar.is_primary) throw badRequest("the primary calendar cannot be deleted")
    objects.calendars.remove(calendar.id)
    events.emit("calendar.deleted", grant, calendar)

    return c.json({ request_id: requestId() })
  })
}

function eventOf(context: NylasRouteContext, c: Context): { grant: NylasGrant; event: NylasEvent } {
  const grant = grantOf(context, c)
  const event = context.objects.events.get(c.req.param("id"))

  if (!event || event.grant_id !== grant.id) throw notFound(`event ${c.req.param("id")}`)

  return { grant, event }
}

function eventRoutes(context: NylasRouteContext): void {
  const { app, objects, events } = context

  app.get(`${GRANT}/events`, (c) => {
    const grant = grantOf(context, c)
    const calendar = queriedCalendar(context, c, grant)
    const after = Number(c.req.query("start") ?? Number.NEGATIVE_INFINITY)
    const before = Number(c.req.query("end") ?? Number.POSITIVE_INFINITY)
    const listed = objects.events.where((event) => {
      const span = spanOf(event.when)

      return (
        event.calendar_id === calendar.id &&
        event.status !== "cancelled" &&
        span.end > after &&
        span.start < before
      )
    })

    return page(
      c,
      listed.toSorted((a, b) => spanOf(a.when).start - spanOf(b.when).start),
    )
  })
  app.get(`${GRANT}/events/:id`, (c) => one(c, eventOf(context, c).event))
  app.post(`${GRANT}/events`, async (c) => {
    const grant = grantOf(context, c)
    const event = newEvent(context, grant, queriedCalendar(context, c, grant), await bodyOf(c))

    objects.events.add(event, null)
    events.emit("event.created", grant, event)

    return one(c, event)
  })
  app.put(`${GRANT}/events/:id`, async (c) => {
    const { grant, event } = eventOf(context, c)
    const changed =
      objects.events.change(event.id, {
        ...eventChanges(await bodyOf(c)),
        updated_at: seconds(context.clock),
      }) ?? event

    events.emit("event.updated", grant, changed)

    return one(c, changed)
  })
  app.delete(`${GRANT}/events/:id`, (c) => {
    const { grant, event } = eventOf(context, c)

    objects.events.remove(event.id)
    events.emit("event.deleted", grant, { ...event, status: "cancelled" })

    return c.json({ request_id: requestId() })
  })
}

/** The busy spans of `email` between `start` and `end`, from the grant's busy events. */
export function busySlots(context: NylasRouteContext, email: string, start: number, end: number) {
  const grant = grantForEmail(context, email)

  if (!grant) return []

  return context.objects.events
    .where((event) => event.grant_id === grant.id && event.busy && event.status !== "cancelled")
    .map((event) => spanOf(event.when))
    .filter((span) => span.end > start && span.start < end)
    .map((span) => ({
      object: "time_slot",
      status: "busy",
      start_time: span.start,
      end_time: span.end,
    }))
}

function freeBusyRoutes(context: NylasRouteContext): void {
  context.app.post(`${GRANT}/calendars/free-busy`, async (c) => {
    grantOf(context, c)

    const body = await bodyOf(c)
    const start = Number(body["start_time"])
    const end = Number(body["end_time"])
    const emails = Array.isArray(body["emails"])
      ? body["emails"].filter((e): e is string => typeof e === "string")
      : []

    return c.json({
      request_id: requestId(),
      data: emails.map((email) => ({
        object: "free_busy",
        email,
        time_slots: busySlots(context, email, start, end),
      })),
    })
  })
}

/** Every calendar route. */
export function calendarRoutesAll(context: NylasRouteContext): void {
  for (const register of [calendarRoutes, eventRoutes, freeBusyRoutes]) register(context)
}
