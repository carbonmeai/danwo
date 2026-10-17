/*
 * A small Gmail integration, written the way such apps are: it watches the user's inbox, queues
 * each Pub/Sub push it receives with the history id it had seen by then, and on "Sync inbox"
 * reads Gmail's history from there and lists the new messages. Plain fetches to Google's real
 * hosts; it knows nothing about danwo.
 *
 * Env: PORT, ACCESS_TOKEN, PUSH_TOPIC. INTEGRATION_BUG=no-dedupe processes every push as it
 * comes, so a push delivered twice lists its messages twice: a bug to catch.
 */
import { createServer } from "node:http"

const gmail = "https://gmail.googleapis.com/gmail/v1/users/me"
const headers = {
  authorization: `Bearer ${process.env.ACCESS_TOKEN ?? ""}`,
  "content-type": "application/json",
}
const dedupe = process.env.INTEGRATION_BUG !== "no-dedupe"

/** Pushes waiting for a sync, each with the history id the app had seen when it arrived. */
const queued = []
const seenPushes = new Set()
/** Messages synced so far, in order. */
const synced = []
let cursor = ""
let status = ""

async function call(path, init = {}) {
  const response = await fetch(`${gmail}${path}`, { ...init, headers })

  if (!response.ok) throw new Error(`Gmail answered ${response.status} to ${path}`)

  return response.status === 204 ? null : response.json()
}

async function watch() {
  cursor = (await call("/profile")).historyId
  await call("/watch", {
    method: "POST",
    body: JSON.stringify({ topicName: process.env.PUSH_TOPIC, labelIds: ["INBOX"] }),
  })
}

async function sendNote() {
  const raw = Buffer.from(
    "To: ada@danwo.test\r\nSubject: Note from danwo\r\n\r\nSynced through a push.",
  ).toString("base64url")

  await call("/messages/send", { method: "POST", body: JSON.stringify({ raw }) })
}

function receivePush(body) {
  const { message } = JSON.parse(body)

  if (dedupe && seenPushes.has(message.messageId)) return
  seenPushes.add(message.messageId)
  queued.push({ since: cursor })
}

async function addedSince(since) {
  const page = await call(
    `/history?startHistoryId=${since}&historyTypes=messageAdded&labelId=INBOX`,
  )
  const ids = (page.history ?? []).flatMap((entry) =>
    (entry.messagesAdded ?? []).map((added) => added.message.id),
  )

  return { ids, historyId: page.historyId }
}

async function subjectOf(id) {
  const message = await call(`/messages/${id}?format=metadata&metadataHeaders=Subject`)

  return message.payload.headers.find((h) => h.name === "Subject")?.value ?? ""
}

async function syncOne(push) {
  const { ids, historyId } = await addedSince(push.since)

  for (const id of ids) {
    if (dedupe && synced.some((m) => m.id === id)) continue
    synced.push({ id, subject: await subjectOf(id) })
  }

  cursor = historyId
}

async function sync() {
  while (queued.length > 0) await syncOne(queued.shift())
}

function page() {
  const items = synced.map((m) => `<li>${m.subject}</li>`).join("")

  return `<!doctype html><title>Inbox sync</title><h1>Inbox sync</h1>
<p role="status">${status}</p>
<form method="post" action="/send"><button>Send a note to myself</button></form>
<form method="post" action="/sync"><button>Sync inbox</button></form>
<ul aria-label="Synced mail">${items}</ul>`
}

/** Runs an action from a button, then shows the page with what happened. */
async function act(res, action, done) {
  try {
    await action()
    status = done
  } catch (error) {
    status = `Failed: ${error.message}`
  }

  res.writeHead(303, { location: "/" })
  res.end()
}

const ROUTES = {
  "GET /": (_body, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(page())
  },
  "GET /synced": (_body, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ synced }))
  },
  "POST /send": (_body, res) => act(res, sendNote, "Sent"),
  "POST /sync": (_body, res) => act(res, sync, "Synced"),
  "POST /push": (body, res) => {
    receivePush(body)
    res.writeHead(204)
    res.end()
  },
}

const server = createServer((req, res) => {
  let body = ""

  req.on("data", (chunk) => (body += chunk))
  req.on("end", () => {
    const route = ROUTES[`${req.method} ${new URL(req.url ?? "/", "http://app").pathname}`]

    if (route) void route(body, res)
    else {
      res.writeHead(404)
      res.end()
    }
  })
})

await watch()
server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening"))
