/*
 * An app under test that syncs a user's Gmail and Calendar the way integrations do, with plain
 * fetches to Google's real hosts: it watches the mailbox, waits for the Pub/Sub push, reads the
 * history since its last sync, and keeps a Calendar sync token, falling back to a full sync when
 * Google answers 410. Prints what it saw as JSON.
 */
import { createServer } from "node:http"

import { z } from "zod"

const token = process.env["ACCESS_TOKEN"] ?? ""
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" }
const gmail = "https://gmail.googleapis.com/gmail/v1/users/me"
const events = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

const PushEnvelope = z.object({ message: z.object({ data: z.string() }) })
const PushData = z.object({ emailAddress: z.string() })
const Profile = z.object({ historyId: z.string() })
const History = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z.array(z.object({ message: z.object({ id: z.string() }) })).default([]),
      }),
    )
    .default([]),
})
const MessageHeaders = z.object({
  payload: z.object({ headers: z.array(z.object({ value: z.string() })) }),
})
const EventPage = z.object({
  items: z.array(z.object({ summary: z.string().optional() })).default([]),
  nextSyncToken: z.string().optional(),
})
const GoogleError = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })) }),
})

/** What the app saw, printed as JSON for the test to read. */
interface Seen {
  gmail?: { push: string | undefined; subjects: string[] }
  calendar?: {
    changed: (string | undefined)[]
    expired: number
    reason: string | undefined
    resynced: (string | undefined)[]
  }
  error?: string
}

const pushes: z.infer<typeof PushData>[] = []
const server = createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    const envelope = PushEnvelope.parse(JSON.parse(body))

    pushes.push(PushData.parse(JSON.parse(Buffer.from(envelope.message.data, "base64").toString())))
    res.statusCode = 204
    res.end()
  })
})

await new Promise<void>((resolve) =>
  server.listen(Number(process.env["PUSH_PORT"]), "127.0.0.1", resolve),
)

/** Calls a Google API and returns the status with the parsed JSON body (null for 204). */
async function call(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, headers })

  return { status: response.status, body: response.status === 204 ? null : await response.json() }
}

async function waitForPush(): Promise<z.infer<typeof PushData> | undefined> {
  for (let tries = 0; tries < 100 && pushes.length === 0; tries++)
    await new Promise((resolve) => setTimeout(resolve, 50))

  return pushes[0]
}

async function subjectOf(id: string): Promise<string> {
  const message = await call(`${gmail}/messages/${id}?format=metadata&metadataHeaders=Subject`)

  return MessageHeaders.parse(message.body).payload.headers[0]?.value ?? ""
}

async function syncGmail(): Promise<NonNullable<Seen["gmail"]>> {
  const profile = Profile.parse((await call(`${gmail}/profile`)).body)
  const raw = Buffer.from(
    "To: ada@danwo.test\r\nSubject: Note to self\r\n\r\nRemember the milk.",
  ).toString("base64url")

  await call(`${gmail}/watch`, {
    method: "POST",
    body: JSON.stringify({ topicName: "projects/app/topics/gmail", labelIds: ["INBOX"] }),
  })
  await call(`${gmail}/messages/send`, { method: "POST", body: JSON.stringify({ raw }) })

  const push = await waitForPush()
  const history = History.parse(
    (
      await call(
        `${gmail}/history?startHistoryId=${profile.historyId}&historyTypes=messageAdded&labelId=INBOX`,
      )
    ).body,
  )
  const added = history.history.flatMap((entry) => entry.messagesAdded.map((m) => m.message.id))
  const subjects: string[] = []

  for (const id of added) subjects.push(await subjectOf(id))

  return { push: push?.emailAddress, subjects }
}

async function syncCalendar(): Promise<NonNullable<Seen["calendar"]>> {
  const full = EventPage.parse((await call(events)).body)

  await call(events, {
    method: "POST",
    body: JSON.stringify({
      summary: "Planning",
      start: { dateTime: "2030-02-01T10:00:00Z" },
      end: { dateTime: "2030-02-01T11:00:00Z" },
    }),
  })

  const changes = EventPage.parse(
    (await call(`${events}?syncToken=${full.nextSyncToken ?? ""}`)).body,
  )
  const again = await call(`${events}?syncToken=${changes.nextSyncToken ?? ""}`)
  const resync = EventPage.parse(again.status === 410 ? (await call(events)).body : again.body)

  return {
    changed: changes.items.map((event) => event.summary),
    expired: again.status,
    reason: GoogleError.safeParse(again.body).data?.error.errors[0]?.reason,
    resynced: resync.items.map((event) => event.summary),
  }
}

const out: Seen = {}

try {
  out.gmail = await syncGmail()
  out.calendar = await syncCalendar()
} catch (error) {
  out.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
}

server.close()
console.log(JSON.stringify(out))
