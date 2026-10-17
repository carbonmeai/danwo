/*
 * A small Slack bot, written the way such bots are: it checks each Events API request's
 * signature, replies in the thread of every mention with `chat.postMessage` on slack.com, then
 * acknowledges the event. It knows nothing about danwo.
 *
 * Env: PORT, BOT_TOKEN, SIGNING_SECRET. SLACK_BUG=no-dedupe handles an event every time it
 * arrives, so a mention delivered twice is answered twice: a bug to catch.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { z } from "zod"

const secret = process.env["SIGNING_SECRET"] ?? ""
const token = process.env["BOT_TOKEN"] ?? ""
const dedupe = process.env["SLACK_BUG"] !== "no-dedupe"
/** Requests older than this are refused, as Slack advises against replays. */
const MAX_AGE_SECONDS = 300

const Callback = z.union([
  z.object({ type: z.literal("url_verification"), challenge: z.string() }),
  z.object({
    type: z.literal("event_callback"),
    event_id: z.string(),
    event: z.object({ type: z.string(), channel: z.string(), ts: z.string(), user: z.string() }),
  }),
])

const seenEvents = new Set<string>()
let replies = 0

/** Whether `given` equals `expected`, compared in constant time. */
function sameSignature(given: string, expected: string): boolean {
  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  )
}

/** Whether a request timestamp is recent enough to trust. */
function fresh(timestamp: number): boolean {
  return Number.isFinite(timestamp) && Date.now() / 1000 - timestamp <= MAX_AGE_SECONDS
}

/** Whether the request carries Slack's v0 signature over its timestamp and body. */
function signed(req: IncomingMessage, body: string): boolean {
  const timestamp = Number(req.headers["x-slack-request-timestamp"])
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`

  return fresh(timestamp) && sameSignature(String(req.headers["x-slack-signature"] ?? ""), expected)
}

/** Replies in the mention's thread. */
async function reply(channel: string, threadTs: string, user: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ channel, thread_ts: threadTs, text: `On it, <@${user}>.` }),
  })
  const { ok } = z.object({ ok: z.boolean() }).parse(await response.json())

  if (ok) replies++
}

/** Replies to a mention the bot hasn't answered yet; with the bug, to every delivery of it. */
async function onMention(eventId: string, event: { channel: string; ts: string; user: string }) {
  if (dedupe && seenEvents.has(eventId)) return

  seenEvents.add(eventId)
  await reply(event.channel, event.ts, event.user).catch(() => undefined)
}

/** Handles one Events API request, replying to a mention before acknowledging it. */
async function onEvent(req: IncomingMessage, body: string, res: ServerResponse): Promise<void> {
  if (!signed(req, body)) {
    res.writeHead(401).end()

    return
  }

  const callback = Callback.parse(JSON.parse(body))

  if (callback.type === "url_verification") {
    res.writeHead(200, { "content-type": "text/plain" }).end(callback.challenge)

    return
  }

  if (callback.event.type === "app_mention") await onMention(callback.event_id, callback.event)

  res.writeHead(200).end()
}

const page = () => `<!doctype html><title>Mention bot</title>
  <h1>Mention bot</h1><p role="status">Replies: ${replies}</p>`

createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/slack/events")
      onEvent(req, body, res).catch(() => res.writeHead(500).end())
    else res.writeHead(200, { "content-type": "text/html" }).end(page())
  })
}).listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
