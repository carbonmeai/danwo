import { google as googleapis } from "googleapis"
import { afterEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import { type GoogleCalendar, googleCalendar } from "../src/google/index.ts"
import { AUTH, authFor, consent, failure, fetchVia, googleWith } from "./google-api.ts"

const CALENDAR = `${AUTH}calendar`

let emulator: Emulator

afterEach(async () => {
  await emulator.close()
})

async function calendarAs(email: string, scopes: readonly string[] = [CALENDAR]) {
  const tokens = await consent(emulator, email, scopes)

  return googleapis.calendar({
    version: "v3",
    auth: authFor(emulator, tokens),
    fetchImplementation: fetchVia(emulator),
  })
}

const standup = {
  summary: "Standup",
  start: { dateTime: "2030-03-04T09:30:00-05:00", timeZone: "America/New_York" },
  end: { dateTime: "2030-03-04T09:45:00-05:00", timeZone: "America/New_York" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"],
}

describe("Calendar events", () => {
  it("creates, reads, patches and cancels events, and lists the user's calendars", async () => {
    emulator = googleWith()
    const ada = await calendarAs("ada@danwo.test")
    const created = await ada.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: "Design review",
        start: { dateTime: "2030-01-10T15:00:00Z" },
        end: { dateTime: "2030-01-10T16:00:00Z" },
        attendees: [{ email: "bob@danwo.test" }],
      },
    })

    expect(created.data).toMatchObject({
      kind: "calendar#event",
      status: "confirmed",
      organizer: { email: "ada@danwo.test", self: true },
      attendees: [{ email: "bob@danwo.test", responseStatus: "needsAction" }],
      sequence: 0,
    })

    const id = created.data.id ?? ""
    const patched = await ada.events.patch({
      calendarId: "primary",
      eventId: id,
      requestBody: { location: "Room 4" },
    })

    expect(patched.data).toMatchObject({
      summary: "Design review",
      location: "Room 4",
      sequence: 1,
    })
    expect(
      await failure(
        ada.events.patch(
          { calendarId: "primary", eventId: id, requestBody: { location: "Room 5" } },
          { headers: { "If-Match": created.data.etag ?? "" } },
        ),
      ),
    ).toEqual({ status: 412, reason: "conditionNotMet" })

    await ada.events.delete({ calendarId: "primary", eventId: id })
    expect(await failure(ada.events.delete({ calendarId: "primary", eventId: id }))).toEqual({
      status: 410,
      reason: "deleted",
    })
    expect((await ada.events.list({ calendarId: "primary" })).data.items).toEqual([])

    const calendars = await ada.calendarList.list()

    expect(calendars.data.items?.map((entry) => [entry.id, entry.primary])).toEqual([
      ["ada@danwo.test", true],
    ])
    expect(
      await failure(
        ada.events.insert({ calendarId: "primary", requestBody: { summary: "No times" } }),
      ),
    ).toEqual({ status: 400, reason: "required" })
  })

  it("expands recurring events in their own time zone and orders instances by start", async () => {
    emulator = googleWith({ calendar: { "ada@danwo.test": [standup] } })
    const ada = await calendarAs("ada@danwo.test", [`${CALENDAR}.readonly`])
    const instances = await ada.events.list({
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
      timeMin: "2030-03-01T00:00:00Z",
    })

    expect(instances.data.items?.map((event) => event.start?.dateTime)).toEqual([
      "2030-03-04T09:30:00-05:00",
      "2030-03-06T09:30:00-05:00",
      "2030-03-11T09:30:00-05:00",
      "2030-03-13T09:30:00-05:00",
    ])
    expect(instances.data.items?.[1]?.id).toMatch(/_20300306T143000Z$/)
    expect(instances.data.items?.[1]?.recurringEventId).toBe(
      googleCalendar(emulator, "ada@danwo.test").events()[0]?.id,
    )
    expect(await failure(ada.events.list({ calendarId: "primary", orderBy: "startTime" }))).toEqual(
      { status: 400, reason: "invalid" },
    )
    expect(
      await failure(ada.events.insert({ calendarId: "primary", requestBody: standup })),
    ).toEqual({ status: 403, reason: "insufficientPermissions" })
  })

  it("answers free/busy from opaque events", async () => {
    emulator = googleWith({
      calendar: {
        "bob@danwo.test": [
          {
            summary: "Focus",
            start: { dateTime: "2030-05-01T10:00:00Z" },
            end: { dateTime: "2030-05-01T11:00:00Z" },
          },
          {
            summary: "Reminder only",
            transparency: "transparent",
            start: { dateTime: "2030-05-01T12:00:00Z" },
            end: { dateTime: "2030-05-01T13:00:00Z" },
          },
        ],
      },
    })
    const ada = await calendarAs("ada@danwo.test", [`${CALENDAR}.freebusy`])
    const busy = await ada.freebusy.query({
      requestBody: {
        timeMin: "2030-05-01T00:00:00Z",
        timeMax: "2030-05-02T00:00:00Z",
        items: [{ id: "bob@danwo.test" }, { id: "nobody@danwo.test" }],
      },
    })

    expect(busy.data.calendars).toEqual({
      "bob@danwo.test": {
        busy: [{ start: "2030-05-01T10:00:00.000Z", end: "2030-05-01T11:00:00.000Z" }],
      },
      "nobody@danwo.test": { errors: [{ domain: "global", reason: "notFound" }], busy: [] },
    })
  })
})

describe("Calendar sync and push", () => {
  it("syncs incrementally with sync tokens and asks for a full sync once they expire", async () => {
    emulator = googleWith({ calendar: { "ada@danwo.test": [standup] } })
    const ada = await calendarAs("ada@danwo.test")
    const full = await ada.events.list({ calendarId: "primary" })
    const calendar: GoogleCalendar = googleCalendar(emulator, "ada@danwo.test")

    expect(full.data.items).toHaveLength(1)

    const added = calendar.add({
      summary: "Dentist",
      start: { date: "2030-03-20" },
      end: { date: "2030-03-21" },
    })

    calendar.cancel(full.data.items?.[0]?.id ?? "")

    const changes = await ada.events.list({
      calendarId: "primary",
      syncToken: full.data.nextSyncToken ?? "",
    })

    expect(changes.data.items?.map((event) => [event.summary, event.status])).toEqual([
      ["Dentist", "confirmed"],
      ["Standup", "cancelled"],
    ])
    expect(changes.data.items?.[0]?.id).toBe(added.id)

    calendar.expireSyncTokens()
    expect(
      await failure(
        ada.events.list({ calendarId: "primary", syncToken: changes.data.nextSyncToken ?? "" }),
      ),
    ).toEqual({ status: 410, reason: "fullSyncRequired" })
  })

  it("sends sync, then exists, on a watch channel until it is stopped", async () => {
    const deliveries: Record<string, string>[] = []

    emulator = googleWith(
      {},
      {
        fetch: async (_url, init) => {
          deliveries.push(Object.fromEntries(new Headers(init?.headers)))

          return new Response(null, { status: 200 })
        },
      },
    )
    const ada = await calendarAs("ada@danwo.test")
    const channel = await ada.events.watch({
      calendarId: "primary",
      requestBody: {
        id: "chan-1",
        type: "web_hook",
        address: "https://app.danwo.test/push/calendar",
        token: "verify-me",
      },
    })

    await ada.events.quickAdd({ calendarId: "primary", text: "Coffee" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await emulator.webhooks?.idle()

    expect(
      deliveries.map((headers) => [
        headers["x-goog-channel-id"],
        headers["x-goog-resource-state"],
        headers["x-goog-message-number"],
        headers["x-goog-channel-token"],
        headers["x-goog-resource-id"],
      ]),
    ).toEqual([
      ["chan-1", "sync", "1", "verify-me", channel.data.resourceId],
      ["chan-1", "exists", "2", "verify-me", channel.data.resourceId],
    ])

    await ada.channels.stop({
      requestBody: { id: "chan-1", resourceId: channel.data.resourceId ?? "" },
    })
    await ada.events.quickAdd({ calendarId: "primary", text: "Tea" })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(deliveries).toHaveLength(2)
    expect(
      await failure(ada.channels.stop({ requestBody: { id: "chan-1", resourceId: "x" } })),
    ).toEqual({ status: 404, reason: "notFound" })
  })
})
