/*
 * A small sales-assistant app, written the way such apps are: it reads a rep's inbox through
 * Nylas, logs notes in the CRM through Nango's proxy, and messages the lead on LinkedIn through
 * Unipile. One click sends the follow-up on all three. It knows nothing about danwo.
 *
 * Env: PORT, NYLAS_API_KEY, NYLAS_GRANT_ID, NANGO_SECRET_KEY, UNIPILE_DSN, UNIPILE_ACCESS_TOKEN,
 * UNIPILE_ACCOUNT_ID. FOLLOW_UP_BUG=resend sends again on every click, so a double-submitted
 * form follows up twice: a bug to catch.
 */
import { createServer, type ServerResponse } from "node:http"

import { Nango } from "@nangohq/node"
import * as nylasSdk from "nylas"
import { UnipileClient } from "unipile-node-sdk"

const env = (name: string) => process.env[name] ?? ""
const port = Number(env("PORT"))
const once = env("FOLLOW_UP_BUG") !== "resend"
/* The package's type files read as CommonJS; at run time its default export is the class. */
const NylasClient: unknown = nylasSdk.default
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ESM build's default is the class the types call default.default
const Nylas = (
  typeof NylasClient === "function" ? NylasClient : nylasSdk.default.default
) as typeof nylasSdk.default.default
const nylas = new Nylas({ apiKey: env("NYLAS_API_KEY") })
const nango = new Nango({ secretKey: env("NANGO_SECRET_KEY") })
const unipile = new UnipileClient(`https://${env("UNIPILE_DSN")}`, env("UNIPILE_ACCESS_TOKEN"))
const grant = env("NYLAS_GRANT_ID")

let notice = ""
/** The follow-up in flight; a second click while it runs waits on it instead of sending again. */
let sending: Promise<string> | undefined

async function followUp(): Promise<string> {
  await nylas.messages.send({
    identifier: grant,
    requestBody: {
      to: [{ email: "lead@prospect.test" }],
      subject: "Following up",
      body: "<p>Shall we talk?</p>",
    },
  })
  await nango.proxy({
    method: "POST",
    endpoint: "/crm/v3/objects/notes",
    providerConfigKey: "hubspot",
    connectionId: "rep-1",
    data: { properties: { hs_note_body: "Followed up by email and LinkedIn" } },
  })
  await unipile.messaging.startNewChat({
    account_id: env("UNIPILE_ACCOUNT_ID"),
    attendees_ids: ["ACoAAlead"],
    text: "Following up on my email",
  })

  return "Follow-up sent"
}

async function home(res: ServerResponse): Promise<void> {
  const inbox = await nylas.messages.list({ identifier: grant, queryParams: { in: ["INBOX"] } })

  res.writeHead(200, { "content-type": "text/html" })
  res.end(`<!doctype html><title>Leads</title><h1>Leads</h1>
<p>Inbox: ${inbox.data.length} messages</p>
<form method="post" action="/follow-up"><button>Send follow-up</button></form>
<p role="status">${notice}</p>`)
}

/** A click on "Send follow-up": the follow-up in flight is shared, so a double submit sends once. */
async function clicked(res: ServerResponse): Promise<void> {
  const send = once
    ? (sending ??= followUp().finally(() => {
        sending = undefined
      }))
    : followUp()

  notice = await send.catch((error: unknown) => `Could not send: ${String(error)}`)
  res.writeHead(303, { location: "/" })
  res.end()
}

createServer((req, res) => {
  const handled = req.method === "POST" && req.url === "/follow-up" ? clicked(res) : home(res)

  handled.catch((error: unknown) => {
    res.writeHead(500)
    res.end(String(error))
  })
}).listen(port, "127.0.0.1")
