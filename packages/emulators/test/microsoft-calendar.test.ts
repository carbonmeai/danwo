import type { Event } from "@microsoft/microsoft-graph-types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import {
  type CalendarEntry,
  type OutlookCalendar,
  microsoftOutboundFaults,
  outlookCalendar,
} from "../src/microsoft/index.ts"
import { ADA, GRACE, graphClient, graphEmulator, graphFetch, tokensFor } from "./microsoft-graph.ts"

const CALENDAR = "Calendars.ReadWrite"
const WEEK = "startDateTime=2026-10-19T00:00:00Z&endDateTime=2026-10-26T00:00:00Z"

let emulator: Emulator

beforeEach(() => {
  emulator = graphEmulator({
    events: [
      {
        user: ADA,
        subject: "Standup",
        start: "2026-10-19T09:00:00Z",
        end: "2026-10-19T09:15:00Z",
        recurrence: {
          pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday", "friday"] },
          range: { type: "endDate", startDate: "2026-10-19", endDate: "2026-12-31" },
        },
      },
      {
        user: ADA,
        subject: "Dentist",
        start: "2026-10-21T14:00:00Z",
        end: "2026-10-21T15:00:00Z",
        showAs: "oof",
      },
      {
        user: GRACE,
        subject: "Offsite",
        start: "2026-10-20T08:00:00Z",
        end: "2026-10-20T17:00:00Z",
      },
    ],
  })
})

afterEach(async () => {
  await emulator.close()
})

describe("events with the Graph client", () => {
  it("creates an event in a Windows time zone and reads it back in UTC or the reader's zone", async () => {
    const client = graphClient(emulator, ADA, CALENDAR)
    const created: Event = await client.api("/me/events").post({
      subject: "Design review",
      start: { dateTime: "2026-10-22T10:00:00", timeZone: "Pacific Standard Time" },
      end: { dateTime: "2026-10-22T11:00:00", timeZone: "Pacific Standard Time" },
      attendees: [{ emailAddress: { address: GRACE, name: "Grace" }, type: "required" }],
      location: { displayName: "Room 4" },
    })

    expect(created).toMatchObject({
      subject: "Design review",
      type: "singleInstance",
      start: { dateTime: "2026-10-22T17:00:00.0000000", timeZone: "UTC" },
      originalStartTimeZone: "Pacific Standard Time",
      location: { displayName: "Room 4" },
    })

    const local = await client
      .api(`/me/events/${created.id}`)
      .header("Prefer", 'outlook.timezone="Pacific Standard Time"')
      .get()

    expect(local.start).toEqual({
      dateTime: "2026-10-22T10:00:00.0000000",
      timeZone: "Pacific Standard Time",
    })
  })

  it("expands a weekly series in calendarView and lists its instances", async () => {
    const client = graphClient(emulator, ADA, CALENDAR)
    const view = await client.api(`/me/calendarView?${WEEK}`).top(50).get()
    const subjects = view.value.map(
      (e: Event) => `${e.subject} ${e.start?.dateTime?.slice(0, 10)} ${e.type}`,
    )

    expect(subjects).toEqual([
      "Standup 2026-10-19 occurrence",
      "Standup 2026-10-21 occurrence",
      "Dentist 2026-10-21 singleInstance",
      "Standup 2026-10-23 occurrence",
    ])

    const [master] = (await client.api("/me/events").filter("subject eq 'Standup'").get()).value
    const instances = await client.api(`/me/events/${master.id}/instances?${WEEK}`).get()

    expect(master.type).toBe("seriesMaster")
    expect(instances.value).toHaveLength(3)
    expect(instances.value[0].seriesMasterId).toBe(master.id)
  })

  it("checks If-Match against the event's change key", async () => {
    const client = graphClient(emulator, ADA, CALENDAR)
    const [dentist] = (await client.api("/me/events").filter("subject eq 'Dentist'").get()).value
    const moved = await client
      .api(`/me/events/${dentist.id}`)
      .header("If-Match", dentist["@odata.etag"])
      .patch({ subject: "Dentist (moved)" })

    expect(moved.subject).toBe("Dentist (moved)")
    await expect(
      client
        .api(`/me/events/${dentist.id}`)
        .header("If-Match", dentist["@odata.etag"])
        .patch({ subject: "stale" }),
    ).rejects.toMatchObject({ statusCode: 412, code: "ErrorIrresolvableConflict" })
  })

  it("needs a window for calendarView and write access to create", async () => {
    const reader = graphClient(emulator, ADA, "Calendars.Read")

    await expect(reader.api("/me/calendarView").get()).rejects.toMatchObject({
      statusCode: 400,
      code: "ErrorInvalidParameter",
    })
    await expect(
      reader.api("/me/events").post({
        subject: "x",
        start: { dateTime: "2026-10-22T10:00:00", timeZone: "UTC" },
        end: { dateTime: "2026-10-22T11:00:00", timeZone: "UTC" },
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: "ErrorAccessDenied" })
  })

  it("keeps events in the calendar they were created in", async () => {
    const client = graphClient(emulator, ADA, CALENDAR)
    const team = await client.api("/me/calendars").post({ name: "Team" })

    await client.api(`/me/calendars/${team.id}/events`).post({
      subject: "Retro",
      start: { dateTime: "2026-10-24T15:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-10-24T16:00:00", timeZone: "UTC" },
    })

    const calendars = await client.api("/me/calendars").get()
    const inTeam = await client.api(`/me/calendars/${team.id}/events`).get()
    const inDefault = await client.api("/me/calendar/events").get()

    expect(calendars.value.map((c: { name: string }) => c.name)).toEqual(["Calendar", "Team"])
    expect(inTeam.value.map((e: Event) => e.subject)).toEqual(["Retro"])
    expect(inDefault.value.map((e: Event) => e.subject)).not.toContain("Retro")
  })
})

describe("calendarView delta", () => {
  it("returns the window, then changed occurrences and removed events", async () => {
    const client = graphClient(emulator, ADA, CALENDAR)
    const first = await client.api(`/me/calendarView/delta?${WEEK}`).get()
    const dentist = first.value.find((e: Event) => e.subject === "Dentist")

    expect(first.value).toHaveLength(4)

    const calendar: OutlookCalendar = outlookCalendar(emulator, ADA)
    const added: string = calendar.add({
      subject: "Coffee",
      start: "2026-10-22T08:00:00Z",
      end: "2026-10-22T08:30:00Z",
    })

    await client.api(`/me/events/${dentist.id}`).delete()

    const changes = await client.api(first["@odata.deltaLink"]).get()

    expect(changes.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: added, subject: "Coffee" }),
        { id: dentist.id, "@removed": { reason: "deleted" } },
      ]),
    )
    expect(changes.value).toHaveLength(2)
  })

  it("answers a token it never issued with 410", async () => {
    const client = graphClient(emulator, ADA, CALENDAR)

    await expect(client.api("/me/calendarView/delta?$deltatoken=nope").get()).rejects.toMatchObject(
      { statusCode: 410 },
    )
  })
})

describe("free/busy", () => {
  it("reports each user's busy slots with getSchedule", async () => {
    const { access } = tokensFor(emulator, ADA, CALENDAR)
    const response = await graphFetch(emulator, access, "/v1.0/me/calendar/getSchedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schedules: [ADA, GRACE, "ghost@contoso.test"],
        startTime: { dateTime: "2026-10-21T13:00:00", timeZone: "UTC" },
        endTime: { dateTime: "2026-10-21T16:00:00", timeZone: "UTC" },
        availabilityViewInterval: 60,
      }),
    })
    const { value } = await response.json()

    expect(value[0]).toMatchObject({
      scheduleId: ADA,
      availabilityView: "030",
      scheduleItems: [{ status: "oof", subject: "Dentist" }],
    })
    expect(value[1]).toMatchObject({ scheduleId: GRACE, availabilityView: "000" })
    expect(value[2]).toMatchObject({ error: { responseCode: "ErrorMailRecipientNotFound" } })
  })

  it("lists what a test sees through outlookCalendar", () => {
    const entries: CalendarEntry[] = outlookCalendar(emulator, GRACE).between(
      "2026-10-20T00:00:00Z",
      "2026-10-21T00:00:00Z",
    )

    expect(entries.map((e) => e.subject)).toEqual(["Offsite"])
    expect(
      microsoftOutboundFaults({ method: "GET", path: "/v1.0/me/calendarView/delta" }),
    ).toContainEqual(expect.objectContaining({ status: 410 }))
  })
})
