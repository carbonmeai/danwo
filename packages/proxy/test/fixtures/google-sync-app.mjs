/*
 * An app under test that syncs a user's Gmail and Calendar the way integrations do, with plain
 * fetches to Google's real hosts: it watches the mailbox, waits for the Pub/Sub push, reads the
 * history since its last sync, and keeps a Calendar sync token, falling back to a full sync when
 * Google answers 410. Prints what it saw as JSON.
 */
import { createServer } from "node:http"

const token = process.env.ACCESS_TOKEN ?? ""
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" }
const gmail = "https://gmail.googleapis.com/gmail/v1/users/me"
const events = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

const pushes = []
const server = createServer((req, res) => {
  let body = ""

  req.on("data", (chunk) => (body += chunk))
  req.on("end", () => {
    pushes.push(JSON.parse(Buffer.from(JSON.parse(body).message.data, "base64").toString()))
    res.statusCode = 204
    res.end()
  })
})

await new Promise((resolve) => server.listen(Number(process.env.PUSH_PORT), "127.0.0.1", resolve))

async function call(url, init = {}) {
  const response = await fetch(url, { ...init, headers })

  return { status: response.status, body: response.status === 204 ? null : await response.json() }
}

async function waitForPush() {
  for (let tries = 0; tries < 100 && pushes.length === 0; tries++)
    await new Promise((resolve) => setTimeout(resolve, 50))

  return pushes[0]
}

async function syncGmail() {
  const profile = await call(`${gmail}/profile`)
  const raw = Buffer.from(
    "To: ada@danwo.test\r\nSubject: Note to self\r\n\r\nRemember the milk.",
  ).toString("base64url")

  await call(`${gmail}/watch`, {
    method: "POST",
    body: JSON.stringify({ topicName: "projects/app/topics/gmail", labelIds: ["INBOX"] }),
  })
  await call(`${gmail}/messages/send`, { method: "POST", body: JSON.stringify({ raw }) })

  const push = await waitForPush()
  const history = await call(
    `${gmail}/history?startHistoryId=${profile.body.historyId}&historyTypes=messageAdded&labelId=INBOX`,
  )
  const added = history.body.history.flatMap((entry) =>
    entry.messagesAdded.map((m) => m.message.id),
  )
  const subjects = []

  for (const id of added) {
    const message = await call(`${gmail}/messages/${id}?format=metadata&metadataHeaders=Subject`)

    subjects.push(message.body.payload.headers[0].value)
  }

  return { push: push?.emailAddress, subjects }
}

async function syncCalendar() {
  const full = await call(events)

  await call(events, {
    method: "POST",
    body: JSON.stringify({
      summary: "Planning",
      start: { dateTime: "2030-02-01T10:00:00Z" },
      end: { dateTime: "2030-02-01T11:00:00Z" },
    }),
  })

  const changes = await call(`${events}?syncToken=${full.body.nextSyncToken}`)
  const again = await call(`${events}?syncToken=${changes.body.nextSyncToken}`)
  const resync = again.status === 410 ? await call(events) : again

  return {
    changed: changes.body.items.map((event) => event.summary),
    expired: again.status,
    reason: again.body?.error?.errors?.[0]?.reason,
    resynced: resync.body.items.map((event) => event.summary),
  }
}

const out = {}

try {
  out.gmail = await syncGmail()
  out.calendar = await syncCalendar()
} catch (error) {
  out.error = String(error?.stack ?? error)
}

server.close()
console.log(JSON.stringify(out))
