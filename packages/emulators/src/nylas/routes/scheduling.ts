/**
 * Scheduler: configurations (whose calendars a booking page offers, and for how long), the open
 * slots they leave, and bookings, which put an event on the organizer's calendar.
 */
import { randomUUID } from "node:crypto"

import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import { callerOf, grantOf } from "../auth.ts"
import type { NylasBooking, NylasConfiguration, NylasGrant } from "../entities.ts"
import {
  badRequest,
  bodyOf,
  type NylasRouteContext,
  notFound,
  one,
  page,
  people,
  requestId,
  seconds,
  text,
} from "../helpers.ts"
import { busySlots, newEvent } from "./calendar.ts"

const CONFIGS = "/v3/grants/:grant/scheduling/configurations"
const BOOKINGS = "/v3/scheduling/bookings"
/** Hours a configuration without its own rules is open, in UTC: 09:00 to 17:00 on weekdays. */
const OPEN = { from: 9, to: 17 } as const

function configurationFields(body: Readonly<Record<string, unknown>>, grant: NylasGrant) {
  const availability = asRecord(body["availability"]) ?? {}
  const duration = Number(availability["duration_minutes"] ?? 30)
  const participants = Array.isArray(body["participants"]) ? body["participants"] : []

  return {
    name: text(body, "name") ?? "Meeting",
    slug: text(body, "slug") ?? null,
    requires_session_auth: body["requires_session_auth"] === true,
    participants:
      participants.length > 0
        ? participants.flatMap((item) => {
            const p = asRecord(item)

            return typeof p?.["email"] === "string" ? [{ ...p, email: p["email"] }] : []
          })
        : [{ email: grant.email, is_organizer: true }],
    availability: {
      ...availability,
      duration_minutes: Number.isFinite(duration) && duration > 0 ? duration : 30,
    },
    event_booking: { title: "Meeting", ...asRecord(body["event_booking"]) },
    scheduler: { ...asRecord(body["scheduler"]) },
  }
}

function configurationRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  const configOf = (c: Context) => {
    const grant = grantOf(context, c)
    const config = objects.configurations.get(c.req.param("id"))

    if (!config || config.grant_id !== grant.id)
      throw notFound(`configuration ${c.req.param("id")}`)

    return { grant, config }
  }

  app.get(CONFIGS, (c) => {
    const grant = grantOf(context, c)

    return page(
      c,
      objects.configurations.where((config) => config.grant_id === grant.id),
    )
  })
  app.get(`${CONFIGS}/:id`, (c) => one(c, configOf(c).config))
  app.post(CONFIGS, async (c) => {
    const grant = grantOf(context, c)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the participants and event booking come from the body's own records; the API keeps what it is given
    const config = {
      id: randomUUID(),
      grant_id: grant.id,
      ...configurationFields(await bodyOf(c), grant),
    } as NylasConfiguration

    return one(c, objects.configurations.add(config, null))
  })
  app.put(`${CONFIGS}/:id`, async (c) => {
    const { grant, config } = configOf(c)
    const body = await bodyOf(c)

    return one(
      c,
      objects.configurations.change(config.id, configurationFields({ ...config, ...body }, grant)),
    )
  })
  app.delete(`${CONFIGS}/:id`, (c) => {
    objects.configurations.remove(configOf(c).config.id)

    return c.json({ request_id: requestId() })
  })
}

/** The configuration a scheduling call names with `configuration_id`. */
function configurationNamed(context: NylasRouteContext, c: Context): NylasConfiguration {
  const id = c.req.query("configuration_id")
  const config = id === undefined ? undefined : context.objects.configurations.get(id)

  if (!config) throw badRequest("configuration_id is required and must name a configuration")
  if (config.requires_session_auth) callerOf(context, c)

  return config
}

/** The organizer of a configuration: its flagged participant, else the first. */
function organizerOf(config: NylasConfiguration) {
  return config.participants.find((p) => p.is_organizer) ?? config.participants[0]
}

/** Whether `start` lies within open hours and every participant is free for the slot. */
function isOpen(
  context: NylasRouteContext,
  config: NylasConfiguration,
  start: number,
  end: number,
) {
  const at = new Date(start * 1000)
  const day = at.getUTCDay()
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60
  const endHour = hour + (end - start) / 3600

  if (day === 0 || day === 6 || hour < OPEN.from || endHour > OPEN.to) return false

  return config.participants.every((p) => busySlots(context, p.email, start, end).length === 0)
}

/** The open slots of `config` between `from` and `to`, stepped by its interval. */
function slotsOf(context: NylasRouteContext, config: NylasConfiguration, from: number, to: number) {
  const length = config.availability.duration_minutes * 60
  const step = (config.availability.interval_minutes ?? config.availability.duration_minutes) * 60
  const emails = config.participants.map((p) => p.email)
  const slots: { emails: string[]; start_time: number; end_time: number }[] = []
  const first = Math.ceil(from / step) * step

  for (let start = first; start + length <= to && slots.length < 500; start += step)
    if (isOpen(context, config, start, start + length))
      slots.push({ emails, start_time: start, end_time: start + length })

  return slots
}

function bookingOf(context: NylasRouteContext, c: Context): NylasBooking & { id: string } {
  const booking = context.objects.bookings.get(c.req.param("id"))

  if (!booking) throw notFound(`booking ${c.req.param("id")}`)

  return booking
}

/** A booking as the API answers it. */
const shown = ({ id: _id, ...booking }: NylasBooking & { id: string }) => booking

function book(
  context: NylasRouteContext,
  config: NylasConfiguration,
  body: Record<string, unknown>,
) {
  const start = Number(body["start_time"])
  const end = Number(body["end_time"])
  const guest = people([body["guest"]])[0]

  if (!guest) throw badRequest("guest.email is required")
  if (!isOpen(context, config, start, end)) throw badRequest("the requested time is not available")

  const organizer = organizerOf(config)
  const grant = context.objects.grants.get(config.grant_id)

  if (!organizer || !grant) throw notFound("organizer")

  const calendar = context.objects.calendars.where(
    (cal) => cal.grant_id === grant.id && cal.is_primary,
  )[0]

  if (!calendar) throw notFound("organizer's calendar")

  const event = newEvent(context, grant, calendar, {
    title: config.event_booking.title,
    description: config.event_booking.description,
    when: { start_time: start, end_time: end },
    participants: [{ email: organizer.email }, guest, ...people(body["additional_guests"])],
  })
  const booking = {
    id: randomUUID(),
    booking_id: "",
    configuration_id: config.id,
    event_id: event.id,
    calendar_id: calendar.id,
    grant_id: grant.id,
    title: event.title,
    description: event.description,
    start_time: start,
    end_time: end,
    organizer: { email: organizer.email, ...(organizer.name && { name: organizer.name }) },
    guest,
    additional_guests: people(body["additional_guests"]),
    status: "booked" as const,
  }

  booking.booking_id = booking.id
  context.objects.events.add(event, null)
  context.objects.bookings.add(booking, null)
  context.events.emit("event.created", grant, event)
  context.events.emit("booking.created", grant, shown(booking))

  return booking
}

function bookingRoutes(context: NylasRouteContext): void {
  const { app, objects, events } = context

  app.get("/v3/scheduling/availability", (c) => {
    const config = configurationNamed(context, c)
    const from = Number(c.req.query("start_time") ?? seconds(context.clock))
    const to = Number(c.req.query("end_time") ?? from + 7 * 86_400)

    return c.json({
      request_id: requestId(),
      data: { time_slots: slotsOf(context, config, from, to), order: [] },
    })
  })
  app.post(BOOKINGS, async (c) =>
    one(c, shown(book(context, configurationNamed(context, c), await bodyOf(c)))),
  )
  app.get(`${BOOKINGS}/:id`, (c) => one(c, shown(bookingOf(context, c))))
  app.patch(`${BOOKINGS}/:id`, async (c) => {
    const booking = bookingOf(context, c)
    const body = await bodyOf(c)
    const start = Number(body["start_time"])
    const end = Number(body["end_time"])
    const grant = objects.grants.get(booking.grant_id)

    objects.events.change(booking.event_id, {
      when: { object: "timespan", start_time: start, end_time: end },
    })

    const changed =
      objects.bookings.change(booking.id, { start_time: start, end_time: end }) ?? booking

    if (grant) events.emit("booking.rescheduled", grant, shown(changed))

    return one(c, shown(changed))
  })

  const cancel = (c: Context) => {
    const booking = bookingOf(context, c)
    const grant = objects.grants.get(booking.grant_id)
    const changed = objects.bookings.change(booking.id, { status: "cancelled" }) ?? booking

    objects.events.remove(booking.event_id)
    if (grant) events.emit("booking.cancelled", grant, shown(changed))

    return changed
  }

  app.delete(`${BOOKINGS}/:id`, (c) => {
    cancel(c)

    return c.json({ request_id: requestId() })
  })

  const confirm = async (c: Context) => {
    const status = text(await bodyOf(c), "status")

    if (status === "cancelled") return one(c, shown(cancel(c)))

    const booking = bookingOf(context, c)

    return one(c, shown(objects.bookings.change(booking.id, { status: "booked" }) ?? booking))
  }

  app.put(`${BOOKINGS}/:id`, confirm)
  app.post(`${BOOKINGS}/:id/confirm`, confirm)
  app.put(`${BOOKINGS}/:id/confirm`, confirm)
}

/** Configurations, availability and bookings. */
export function schedulingRoutes(context: NylasRouteContext): void {
  configurationRoutes(context)
  bookingRoutes(context)
}
