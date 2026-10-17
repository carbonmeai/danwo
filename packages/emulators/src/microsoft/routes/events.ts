import type { Context } from "../../http.ts"
import type { GraphCall } from "../access.ts"
import { userRoute } from "../access.ts"
import {
  addEvent,
  calendars,
  calendarView,
  createCalendar,
  defaultCalendar,
  deleteEvent,
  updateEvent,
} from "../calendar.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import type { CalendarRecord, EventRecord } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { jsonBody, text } from "../input.ts"
import { listResponse } from "../odata.ts"
import { calendarObject, eventObject, type Occurrence } from "../outlook-formatters.ts"
import { seriesOccurrences } from "../recurrence.ts"
import { eventInput, viewWindow } from "./event-input.ts"
import { appliedHeaders, preferences } from "./mail-input.ts"
import { itemNotFound } from "./messages.ts"

/** The calendar a path names: `/calendar` is the default, `/calendars/:calendar` any other. */
function calendarFor(
  c: Context,
  context: MicrosoftRouteContext,
  call: GraphCall,
): CalendarRecord | undefined {
  const id = c.req.param("calendar")

  return id
    ? calendars(context, call.user.oid).find((cal) => cal.graphId === id)
    : defaultCalendar(context, call.user.oid)
}

/** The routes for a path under each of `/events`, `/calendar/events` and `/calendars/:calendar/events`. */
const SCOPES = ["", "/calendar", "/calendars/:calendar"] as const

function findEvent(call: GraphCall, id: string): EventRecord | undefined {
  const found = call.microsoft.events.findOneBy("graphId", id)

  return found?.owner === call.user.oid ? found : undefined
}

/** Answers with occurrences as Graph's event list, honouring the reader's `Prefer` choices. */
function occurrenceList(c: Context, call: GraphCall, occurrences: readonly Occurrence[]) {
  const prefs = preferences(c)

  return c.json(
    listResponse(
      c,
      occurrences.map((o) => eventObject(o, call.user, prefs)),
      { defaultPageSize: 10 },
    ),
    200,
    appliedHeaders(c),
  )
}

function eventResponse(c: Context, call: GraphCall, event: EventRecord, status = 200) {
  const occurrence = { event, start: event.start, end: event.end }

  return c.json(eventObject(occurrence, call.user, preferences(c)), status, appliedHeaders(c))
}

/** Graph's 412 when `If-Match` names an older version of the event. */
function staleVersion(
  c: Context,
  context: MicrosoftRouteContext,
  event: EventRecord,
): Response | undefined {
  const expected = c.req.header("if-match")

  if (!expected || expected === "*" || expected === `W/"${event.changeKey}"`) return undefined

  return graphError(c, context.clock, {
    status: 412,
    code: "ErrorIrresolvableConflict",
    message:
      "The send or update operation could not be performed because the change key passed in the request does not match the current change key for the item.",
  })
}

function calendarRoutes(context: MicrosoftRouteContext): void {
  userRoute(context, "get", "/calendars", "Calendars.Read", (c, call) =>
    c.json(
      listResponse(
        c,
        calendars(context, call.user.oid).map((cal) => calendarObject(cal, call.user)),
      ),
    ),
  )

  for (const path of ["/calendar", "/calendars/:calendar"])
    userRoute(context, "get", path, "Calendars.Read", (c, call) => {
      const calendar = calendarFor(c, context, call)

      return calendar ? c.json(calendarObject(calendar, call.user)) : itemNotFound(c, context)
    })

  userRoute(context, "post", "/calendars", "Calendars.ReadWrite", async (c, call) => {
    const name = text((await jsonBody(c)).name) ?? "Calendar"

    return c.json(calendarObject(createCalendar(context, call.user.oid, name), call.user), 201)
  })
}

function collectionRoutes(context: MicrosoftRouteContext): void {
  for (const scope of SCOPES) {
    userRoute(context, "get", `${scope}/events`, "Calendars.Read", (c, call) => {
      const calendar = scope === "" ? undefined : calendarFor(c, context, call)

      if (scope !== "" && !calendar) return itemNotFound(c, context)

      const events = call.microsoft.events
        .findBy("owner", call.user.oid)
        .filter((e) => !calendar || e.calendarId === calendar.graphId)

      return occurrenceList(
        c,
        call,
        events.map((event) => ({ event, start: event.start, end: event.end })),
      )
    })

    userRoute(context, "post", `${scope}/events`, "Calendars.ReadWrite", async (c, call) => {
      const calendar = calendarFor(c, context, call)
      const fields = eventInput(await jsonBody(c))

      if (!calendar) return itemNotFound(c, context)
      if (!fields.start || !fields.end)
        return graphError(c, context.clock, {
          status: 400,
          code: "ErrorInvalidRequest",
          message:
            "Your request can't be completed. The start and end time of the event are required.",
        })

      return eventResponse(c, call, addEvent(context, call.user.oid, calendar.graphId, fields), 201)
    })

    userRoute(context, "get", `${scope}/calendarView`, "Calendars.Read", (c, call) => {
      const window = viewWindow(c, context.clock)
      const calendar = scope === "" ? undefined : calendarFor(c, context, call)

      if (window instanceof Response) return window

      return occurrenceList(
        c,
        call,
        calendarView(context, call.user.oid, {
          ...window,
          ...(calendar && { calendarId: calendar.graphId }),
        }),
      )
    })
  }
}

function itemRoutes(context: MicrosoftRouteContext): void {
  const withEvent =
    (handler: (c: Context, call: GraphCall, event: EventRecord) => Response | Promise<Response>) =>
    (c: Context, call: GraphCall) => {
      const event = findEvent(call, c.req.param("id"))

      return event ? handler(c, call, event) : itemNotFound(c, context)
    }

  userRoute(
    context,
    "get",
    "/events/:id",
    "Calendars.Read",
    withEvent((c, call, event) => eventResponse(c, call, event)),
  )

  userRoute(
    context,
    "patch",
    "/events/:id",
    "Calendars.ReadWrite",
    withEvent(async (c, call, event) => {
      const conflict = staleVersion(c, context, event)

      if (conflict) return conflict

      return eventResponse(c, call, updateEvent(context, event, eventInput(await jsonBody(c))))
    }),
  )

  userRoute(
    context,
    "delete",
    "/events/:id",
    "Calendars.ReadWrite",
    withEvent((c, _call, event) => {
      const conflict = staleVersion(c, context, event)

      if (conflict) return conflict
      deleteEvent(context, event)

      return c.body(null, 204)
    }),
  )

  userRoute(
    context,
    "get",
    "/events/:id/instances",
    "Calendars.Read",
    withEvent((c, call, event) => {
      const window = viewWindow(c, context.clock)

      return window instanceof Response
        ? window
        : occurrenceList(c, call, seriesOccurrences(event, window.from, window.to))
    }),
  )
}

/** Calendars and their events: lists, views over a window with series expanded, and edits. */
export function eventRoutes(context: MicrosoftRouteContext): void {
  calendarRoutes(context)
  collectionRoutes(context)
  itemRoutes(context)
}
