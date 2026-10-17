/*
 * An app under test that knows nothing about the proxy: a Slack app with plain fetch calls to
 * slack.com. It installs itself through OAuth v2 (the "browser" steps are fetches), joins
 * #general, then serves its Events API endpoint, checking Slack's request signature. When it is
 * mentioned it replies in the thread, prints what it saw as JSON and exits.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"

const CLIENT_ID = process.env.CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? ""
const SIGNING_SECRET = process.env.SIGNING_SECRET ?? ""
const REDIRECT = "https://app.danwo.test/slack/oauth"

/** A Web API answer, read loosely: the fields this app uses. */
interface Answer {
  ok?: boolean
  error?: string
  access_token?: string
  bot_user_id?: string
  ts?: string
  channels?: { id?: string; name?: string }[]
}

const pick = (pattern: RegExp, text: string) => pattern.exec(text)?.[1] ?? ""

async function api(method: string, token: string, body: Record<string, string>): Promise<Answer> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  })
  const answer: Answer = await response.json()

  if (!answer.ok) throw new Error(`${method}: ${answer.error ?? "failed"}`)

  return answer
}

/** Opens the install page, approves as `email` and exchanges the code for a bot token. */
async function install(email: string): Promise<{ token: string; botUserId: string }> {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "app_mentions:read,chat:write,channels:read,channels:join",
    redirect_uri: REDIRECT,
    state: "install-1",
  })
  const page = await (
    await fetch(`https://slack.com/oauth/v2/authorize?${query.toString()}`)
  ).text()
  const item = page.split("<li>").find((li) => li.includes(email)) ?? ""
  const back = await fetch("https://slack.com/oauth/v2/authorize", {
    method: "POST",
    body: new URLSearchParams({
      request: pick(/name="request" value="([^"]+)"/, page),
      user: pick(/name="user" value="([^"]+)"/, item),
    }),
    redirect: "manual",
  })
  const code = new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? ""
  const access = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  })
  const granted: Answer = await access.json()

  return { token: granted.access_token ?? "", botUserId: granted.bot_user_id ?? "" }
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ""

    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => resolve(body))
  })
}

/** Slack's request signature check, as its docs describe it. */
function signed(req: IncomingMessage, body: string): boolean {
  const timestamp = String(req.headers["x-slack-request-timestamp"] ?? "")
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300
  const expected = `v0=${createHmac("sha256", SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest("hex")}`
  const given = String(req.headers["x-slack-signature"] ?? "")

  return (
    fresh &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  )
}

interface Envelope {
  type?: string
  challenge?: string
  event?: { type?: string; channel?: string; ts?: string; user?: string; text?: string }
}

const { token, botUserId } = await install("ada@danwo.test")
const { channels = [] } = await api("conversations.list", token, {})
const general = channels.find((channel) => channel.name === "general")?.id ?? ""

await api("conversations.join", token, { channel: general })

const server = createServer((req, res) => {
  void (async () => {
    const body = await read(req)

    if (!signed(req, body)) {
      res.statusCode = 401
      res.end()

      return
    }

    const envelope: Envelope = JSON.parse(body)

    if (envelope.type === "url_verification") {
      res.end(envelope.challenge)

      return
    }

    res.end()

    const event = envelope.event ?? {}

    if (event.type !== "app_mention") return

    const reply = await api("chat.postMessage", token, {
      channel: event.channel ?? "",
      thread_ts: event.ts ?? "",
      text: `Hello <@${event.user ?? ""}>`,
    })

    console.log(JSON.stringify({ mention: event.text, replied: reply.ts !== undefined }))
    server.close()
  })()
})

server.listen(Number(process.env.EVENTS_PORT), "127.0.0.1", () => {
  console.log(JSON.stringify({ ready: true, botUserId }))
})
