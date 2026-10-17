import type { ScheduleInformation } from "@microsoft/microsoft-graph-types"

import type { Context } from "../../http.ts"
import type { GraphCall } from "../access.ts"
import { userRoute } from "../access.ts"
import { calendarView } from "../calendar.ts"
import { changesSince, decodeToken, encodeToken, latestChange } from "../changes.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import type { MicrosoftUser } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { asObject, jsonBody, list, text } from "../input.ts"
import { selected, withParam } from "../odata.ts"
import { eventObject, type Occurrence, type Preferences } from "../outlook-formatters.ts"
import { occurrencesIn } from "../recurrence.ts"
import { formatInZone, toInstant } from "../time-zones.ts"
import { viewWindow } from "./event-input.ts"
import { appliedHeaders, preferences } from "./mail-input.ts"

interface ViewToken {
  readonly since: number
  readonly from: number
  readonly to: number
}

function readToken(c: Context): ViewToken | undefined {
  const token = decodeToken(c.req.query("$deltatoken") ?? "")

  return typeof token?.s === "number" && typeof token.a === "number" && typeof token.b === "number"
    ? { since: token.s, from: token.a, to: token.b }
    : undefined
}

/** What changed in the window since the token: changed events' occurrences, or `@removed`. */
function changedOccurrences(
  context: MicrosoftRouteContext,
  call: GraphCall,
  token: ViewToken,
  prefs: Preferences,
) {
  return changesSince(context, { owner: call.user.oid, kind: "event", since: token.since }).flatMap(
    (change): object[] => {
      const event = call.microsoft.events.findOneBy("graphId", change.targetId)
      const inside = event ? occurrencesIn(event, token.from, token.to) : []

      return inside.length > 0
        ? inside.map((o) => eventObject(o, call.user, prefs))
        : [{ id: change.targetId, "@removed": { reason: "deleted" } }]
    },
  )
}

/**
 * `calendarView/delta`: the first round returns every occurrence in the window and a delta link;
 * later rounds return the occurrences of events that changed since, and `@removed` for events
 * deleted or moved out of the window.
 */
function viewDelta(c: Context, context: MicrosoftRouteContext, call: GraphCall): Response {
  const url = new URL(c.req.url)
  const base = `${url.origin}${url.pathname}`
  const prefs = preferences(c)

  if (c.req.query("$deltatoken") !== undefined) {
    const token = readToken(c)

    if (!token)
      return graphError(c, context.clock, {
        status: 410,
        code: "SyncStateNotFound",
        message: "The sync state generation is no longer valid. Please resync.",
      })

    const value = changedOccurrences(context, call, token, prefs)
    const next = encodeToken({ s: latestChange(context), a: token.from, b: token.to })

    return c.json(
      { value, "@odata.deltaLink": withParam(base, "$deltatoken", next) },
      200,
      appliedHeaders(c),
    )
  }

  const window = viewWindow(c, context.clock)

  if (window instanceof Response) return window

  const select = c.req.query("$select")
  const value = calendarView(context, call.user.oid, window).map((o: Occurrence) =>
    selected(eventObject(o, call.user, prefs), select),
  )
  const token = encodeToken({ s: latestChange(context), a: window.from, b: window.to })

  return c.json(
    { value, "@odata.deltaLink": withParam(base, "$deltatoken", token) },
    200,
    appliedHeaders(c),
  )
}

const AVAILABILITY = {
  free: "0",
  tentative: "1",
  busy: "2",
  oof: "3",
  workingElsewhere: "4",
  unknown: "0",
}

/** Free/busy for one user over the window, in `interval`-minute slots. */
function schedule(
  context: MicrosoftRouteContext,
  user: MicrosoftUser,
  window: { from: number; to: number; interval: number; zone: string },
): ScheduleInformation {
  const busy = calendarView(context, user.oid, window).filter(
    (o) => o.event.showAs !== "free" && !o.event.isCancelled,
  )
  const slots = Math.ceil((window.to - window.from) / (window.interval * 60_000))
  const view = Array.from({ length: slots }, (_, i) => {
    const start = window.from + i * window.interval * 60_000
    const end = start + window.interval * 60_000
    const hit = busy.find((o) => Date.parse(o.start) < end && Date.parse(o.end) > start)

    return hit ? AVAILABILITY[hit.event.showAs] : "0"
  }).join("")

  return {
    scheduleId: user.email,
    availabilityView: view,
    scheduleItems: busy.map((o) => ({
      isPrivate: false,
      status: o.event.showAs,
      subject: o.event.subject,
      location: o.event.location,
      start: { dateTime: formatInZone(o.start, window.zone), timeZone: window.zone },
      end: { dateTime: formatInZone(o.end, window.zone), timeZone: window.zone },
    })),
  }
}

/** `getSchedule`: free/busy for the users the request names, each looked up by address. */
async function getSchedule(c: Context, context: MicrosoftRouteContext): Promise<Response> {
  const raw = await jsonBody(c)
  const start = asObject(raw.startTime)
  const end = asObject(raw.endTime)
  const zone = text(start.timeZone) ?? "UTC"
  const window = {
    from: Date.parse(toInstant(text(start.dateTime) ?? "", zone)),
    to: Date.parse(toInstant(text(end.dateTime) ?? "", text(end.timeZone) ?? zone)),
    interval: Number(raw.availabilityViewInterval) || 30,
    zone,
  }
  const users = context.microsoft().users.all()
  const value = list(raw.schedules).map((id) => {
    const user = users.find((u) => u.email.toLowerCase() === String(id).toLowerCase())

    return user
      ? schedule(context, user, window)
      : {
          scheduleId: String(id),
          error: {
            message: "The specified user could not be found.",
            responseCode: "ErrorMailRecipientNotFound",
          },
        }
  })

  return c.json({ value })
}

/** Keeping a calendar view in sync, and free/busy lookups. */
export function calendarSyncRoutes(context: MicrosoftRouteContext): void {
  for (const path of ["/calendarView/delta", "/calendar/calendarView/delta"])
    userRoute(context, "get", path, "Calendars.Read", (c, call) => viewDelta(c, context, call))

  userRoute(context, "post", "/calendar/getSchedule", "Calendars.Read", (c) =>
    getSchedule(c, context),
  )
}
