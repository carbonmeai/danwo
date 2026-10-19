/*
 * A small assistant app built on Composio, written the way such apps are: the user connects Gmail
 * through Composio's hosted link, the app sends mail with the `GMAIL_SEND_EMAIL` tool, and it
 * counts new-mail triggers from Composio's signed webhooks. It knows nothing about danwo.
 *
 * Env: PORT, COMPOSIO_API_KEY, COMPOSIO_AUTH_CONFIG (the Gmail auth config), COMPOSIO_WEBHOOK_SECRET.
 * INBOX_BUG=resend sends the summary again on every click, so a double-submitted form mails the
 * team twice: a bug to catch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import { Composio } from "@composio/core"

const port = Number(process.env["PORT"])
const authConfig = process.env["COMPOSIO_AUTH_CONFIG"] ?? ""
const webhookSecret = process.env["COMPOSIO_WEBHOOK_SECRET"] ?? ""
const once = process.env["INBOX_BUG"] !== "resend"
const composio = new Composio({
  apiKey: process.env["COMPOSIO_API_KEY"] ?? "",
  allowTracking: false,
})
const USER = "ada"

let notice = ""
let triggers = 0
/** The summary's send, started once; a second click waits on the first instead of sending again. */
let sending: Promise<string> | undefined

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of req)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))

  return Buffer.concat(chunks).toString()
}

async function connected(): Promise<boolean> {
  const accounts = await composio.connectedAccounts.list({
    userIds: [USER],
    authConfigIds: [authConfig],
    statuses: ["ACTIVE"],
  })

  return accounts.items.length > 0
}

async function home(res: ServerResponse): Promise<void> {
  const gmail = (await connected()) ? "connected" : "not connected"

  res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Inbox</title>
<h1>Gmail: ${gmail}</h1>
<a href="/connect">Connect Gmail</a>
<form method="post" action="/send"><button>Send the weekly summary</button></form>
<p role="alert">${notice}</p>
<p role="status">New mail: ${triggers}</p>`)
}

async function connect(res: ServerResponse): Promise<void> {
  const request = await composio.connectedAccounts.link(USER, authConfig, {
    callbackUrl: `http://127.0.0.1:${port}/connected`,
    allowMultiple: true,
  })

  res.writeHead(302, { location: request.redirectUrl ?? "/" }).end()
}

async function sendSummary(): Promise<string> {
  try {
    const result = await composio.tools.execute("GMAIL_SEND_EMAIL", {
      userId: USER,
      arguments: {
        recipient_email: "team@inbox.test",
        subject: "Weekly summary",
        body: "All good.",
      },
      dangerouslySkipVersionCheck: true,
    })

    if (!result.successful) sending = undefined

    return result.successful ? "Sent" : "Could not send, try again"
  } catch {
    sending = undefined

    return "Could not send, try again"
  }
}

async function send(res: ServerResponse): Promise<void> {
  if (!once) sending = undefined
  sending ??= sendSummary()
  notice = await sending
  res.writeHead(303, { location: "/" }).end()
}

async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = await bodyOf(req)

  try {
    await composio.triggers.verifyWebhook({
      payload,
      id: String(req.headers["webhook-id"] ?? ""),
      timestamp: String(req.headers["webhook-timestamp"] ?? ""),
      signature: String(req.headers["webhook-signature"] ?? ""),
      secret: webhookSecret,
    })
  } catch {
    res.writeHead(401).end()

    return
  }

  triggers++
  res.writeHead(200).end()
}

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname
  const route =
    req.method === "POST" && path === "/send"
      ? send(res)
      : req.method === "POST" && path === "/webhooks/composio"
        ? webhook(req, res)
        : path === "/connect"
          ? connect(res)
          : path === "/connected"
            ? Promise.resolve(void res.writeHead(302, { location: "/" }).end())
            : home(res)

  route.catch((error: unknown) => {
    res.writeHead(500).end(error instanceof Error ? error.message : String(error))
  })
}).listen(port, "127.0.0.1", () => console.log("listening"))
