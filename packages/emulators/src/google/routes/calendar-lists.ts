import { randomBytes } from "node:crypto"

import type { calendar_v3 } from "googleapis"

import { badRequest, isRecord, jsonBody, requireAccess } from "../api.ts"
import { calendarListEntry, calendarOf, calendarResource, primaryCalendar } from "../calendar.ts"
import type { GoogleRouteContext } from "../context.ts"
import { instantOf, instancesOf, wallTimeOf } from "../recurrence.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"

const V3 = "/calendar/v3"

/** A free/busy window as the API reports it, in UTC. */
interface Busy {
  readonly start: string
  readonly end: string
}

/** The busy periods of `calendarId` overlapping `[from, to)`: opaque, not-cancelled instances. */
function busyIn(context: GoogleRouteContext, calendarId: string, from: number, to: number): Busy[] {
  return googleStore(context.store)
    .events.findBy("calendarId", calendarId)
    .filter(
      (record) =>
        record.event.status !== "cancelled" && record.event.transparency !== "transparent",
    )
    .flatMap((record) => instancesOf(record.event, to))
    .map((event) => ({ start: wallTimeOf(event.start), end: wallTimeOf(event.end) }))
    .flatMap(({ start, end }) =>
      start && end ? [{ start: instantOf(start), end: instantOf(end) }] : [],
    )
    .filter(({ start, end }) => start < to && end > from)
    .toSorted((a, b) => a.start - b.start)
    .map(({ start, end }) => ({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    }))
}

/** A text field, or an empty string. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** The window and calendars a free/busy query asks about. */
function freeBusyRequest(body: Record<string, unknown>) {
  return {
    timeMin: textOf(body.timeMin),
    timeMax: textOf(body.timeMax),
    items: Array.isArray(body.items) ? body.items.filter(isRecord) : [],
  }
}

/** The calendar list, calendars, and free/busy. */
export function calendarListRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const calendars = () => googleStore(context.store).calendars
  const known = (id: string) => calendars().findOneBy("calendarId", id)

  app.get(`${V3}/users/me/calendarList`, (c) => {
    const caller = requireAccess(c, context, SCOPES.calendarRead)

    primaryCalendar(context, caller.user)

    return c.json({
      kind: "calendar#calendarList",
      etag: `"${caller.user.uid}"`,
      items: calendars()
        .all()
        .filter((calendar) => calendar.owner === caller.user.uid)
        .map(calendarListEntry),
    } satisfies calendar_v3.Schema$CalendarList)
  })

  app.get(`${V3}/users/me/calendarList/:calendarId`, (c) => {
    const caller = requireAccess(c, context, SCOPES.calendarRead)

    return c.json(calendarListEntry(calendarOf(context, caller, c.req.param("calendarId"))))
  })

  app.get(`${V3}/calendars/:calendarId`, (c) => {
    const caller = requireAccess(c, context, SCOPES.calendarRead)

    return c.json(calendarResource(calendarOf(context, caller, c.req.param("calendarId"))))
  })

  app.post(`${V3}/calendars`, async (c) => {
    const caller = requireAccess(c, context, SCOPES.calendarManage)
    const body = await jsonBody(c)

    if (typeof body.summary !== "string" || body.summary === "")
      throw badRequest("Missing title.", "required")

    const calendar = calendars().insert({
      calendarId: `${randomBytes(16).toString("hex")}@group.calendar.google.com`,
      owner: caller.user.uid,
      summary: body.summary,
      description: typeof body.description === "string" ? body.description : null,
      timeZone: typeof body.timeZone === "string" ? body.timeZone : "UTC",
      primary: false,
      generation: 1,
    })

    return c.json(calendarResource(calendar))
  })

  app.delete(`${V3}/calendars/:calendarId`, (c) => {
    const caller = requireAccess(c, context, SCOPES.calendarManage)
    const calendar = calendarOf(context, caller, c.req.param("calendarId"))

    if (calendar.primary)
      throw badRequest("Cannot delete primary calendar.", "cannotDeletePrimaryCalendar")
    calendars().delete(calendar.id)

    return c.body(null, 204)
  })

  app.post(`${V3}/freeBusy`, async (c) => {
    const caller = requireAccess(c, context, SCOPES.calendarFreeBusy)
    const { timeMin, timeMax, items } = freeBusyRequest(await jsonBody(c))

    primaryCalendar(context, caller.user)

    const entries = items.map((item) => {
      const id = item.id === "primary" ? caller.user.email : String(item.id)

      return [
        id,
        known(id)
          ? { busy: busyIn(context, id, Date.parse(timeMin), Date.parse(timeMax)) }
          : { errors: [{ domain: "global", reason: "notFound" }], busy: [] },
      ] as const
    })

    return c.json({
      kind: "calendar#freeBusy",
      timeMin,
      timeMax,
      calendars: Object.fromEntries(entries),
    } satisfies calendar_v3.Schema$FreeBusyResponse)
  })
}
