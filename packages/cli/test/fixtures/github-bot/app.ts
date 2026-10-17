/*
 * A small GitHub bot, written the way such bots are: it checks each webhook's
 * `X-Hub-Signature-256`, thanks the author of every newly opened issue with a comment on
 * api.github.com, then acknowledges the delivery. It knows nothing about danwo.
 *
 * Env: PORT, BOT_TOKEN, WEBHOOK_SECRET. GITHUB_BUG=no-dedupe handles a delivery every time it
 * arrives, so an issue delivered twice is thanked twice: a bug to catch.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { z } from "zod"

const secret = process.env["WEBHOOK_SECRET"] ?? ""
const token = process.env["BOT_TOKEN"] ?? ""
const dedupe = process.env["GITHUB_BUG"] !== "no-dedupe"

const Opened = z.object({
  action: z.string(),
  issue: z.object({ number: z.number(), user: z.object({ login: z.string() }) }),
  repository: z.object({ full_name: z.string() }),
})

const seenDeliveries = new Set<string>()
let comments = 0

/** Whether the delivery carries GitHub's HMAC-SHA256 signature over its body. */
function signed(req: IncomingMessage, body: string): boolean {
  const given = String(req.headers["x-hub-signature-256"] ?? "")
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  )
}

/** Thanks the issue's author with a comment. */
async function thank(repo: string, issue: number, author: string): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}/comments`, {
    method: "POST",
    headers: {
      authorization: `token ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body: `Thanks for the report, @${author}!` }),
  })

  if (response.status === 201) comments++
}

/** Whether this delivery is new to the bot; with the bug, every delivery is. */
function firstSight(delivery: string): boolean {
  const seen = dedupe && seenDeliveries.has(delivery)

  seenDeliveries.add(delivery)

  return !seen
}

/** Thanks the author when the payload is a newly opened issue. */
async function onIssues(body: string): Promise<void> {
  const event = Opened.parse(JSON.parse(body))

  if (event.action !== "opened") return

  await thank(event.repository.full_name, event.issue.number, event.issue.user.login).catch(
    () => undefined,
  )
}

/** Whether the bot should act on this delivery: a new `issues` event. */
function wanted(req: IncomingMessage): boolean {
  const isNew = firstSight(String(req.headers["x-github-delivery"] ?? ""))

  return isNew && req.headers["x-github-event"] === "issues"
}

/** Handles one delivery, commenting on a newly opened issue before acknowledging it. */
async function onDelivery(req: IncomingMessage, body: string, res: ServerResponse): Promise<void> {
  if (!signed(req, body)) {
    res.writeHead(401).end()

    return
  }

  if (wanted(req)) await onIssues(body)

  res.writeHead(200).end()
}

const page = () => `<!doctype html><title>Thanks bot</title>
  <h1>Thanks bot</h1><p role="status">Comments: ${comments}</p>`

createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/github")
      onDelivery(req, body, res).catch(() => res.writeHead(500).end())
    else res.writeHead(200, { "content-type": "text/html" }).end(page())
  })
}).listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
