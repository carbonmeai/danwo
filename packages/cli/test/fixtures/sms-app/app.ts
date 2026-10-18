/*
 * A small app that checks a phone number with Twilio Verify, written the way such apps are: the
 * official Twilio client on its real hosts. Once a number is verified it texts a welcome with a
 * status callback, checks each callback's X-Twilio-Signature, and counts the welcomes Twilio
 * delivered. It knows nothing about danwo.
 *
 * Env: PORT, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VERIFY_SERVICE, FROM_NUMBER. SMS_BUG=no-dedupe
 * counts every "delivered" callback it gets, so a callback Twilio sends twice is counted twice: a
 * bug to catch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import twilio from "twilio"

const token = process.env["TWILIO_AUTH_TOKEN"] ?? ""
const client = twilio(process.env["TWILIO_ACCOUNT_SID"], token)
const verify = client.verify.v2.services(process.env["VERIFY_SERVICE"] ?? "")
const from = process.env["FROM_NUMBER"] ?? ""
const base = `http://127.0.0.1:${process.env["PORT"]}`
const dedupe = process.env["SMS_BUG"] !== "no-dedupe"

const deliveredSids = new Set<string>()
let delivered = 0

const page = (title: string, body = "") => `<!doctype html><title>${title}</title>
  <main><h1>${title}</h1>${body}<p role="status">Welcomes delivered: ${delivered}</p></main>`

const start = () =>
  page(
    "Verify your phone",
    `<form method="post" action="/phone">
    <label>Phone <input name="phone" type="tel"></label>
    <button type="submit">Send code</button>
  </form>`,
  )

const codePage = (phone: string) =>
  page(
    "Check your phone",
    `<form method="post" action="/confirm">
      <input type="hidden" name="phone" value="${phone}">
      <label>Code <input name="code" autocomplete="one-time-code"></label>
      <button type="submit">Verify</button>
    </form>`,
  )

const trouble = (what: string) => page("Something went wrong", `<p role="alert">${what}</p>`)

async function sendCode(phone: string): Promise<string> {
  try {
    await verify.verifications.create({ to: phone, channel: "sms" })

    return codePage(phone)
  } catch {
    return trouble("We could not send a code. Try again.")
  }
}

async function confirm(phone: string, code: string): Promise<string> {
  try {
    const check = await verify.verificationChecks.create({ to: phone, code })

    if (check.status !== "approved") return trouble("That code is not right.")

    await client.messages.create({
      from,
      to: phone,
      body: "Welcome aboard!",
      statusCallback: `${base}/twilio/status`,
    })

    return page(`Verified ${phone}`)
  } catch {
    return trouble("We could not check the code. Try again.")
  }
}

/** Whether a status callback should count: a delivery, seen for the first time unless the bug is on. */
function counts(fields: URLSearchParams): boolean {
  const sid = fields.get("MessageSid") ?? ""

  return fields.get("MessageStatus") === "delivered" && !(dedupe && deliveredSids.has(sid))
}

/** Whether Twilio signed this request, with the account's auth token. */
function fromTwilio(req: IncomingMessage, fields: URLSearchParams): boolean {
  const signature = String(req.headers["x-twilio-signature"] ?? "")

  return twilio.validateRequest(token, signature, `${base}${req.url}`, Object.fromEntries(fields))
}

/** A status callback: refused unless Twilio signed it; a delivered welcome is counted. */
function onStatus(req: IncomingMessage, fields: URLSearchParams, res: ServerResponse): void {
  if (!fromTwilio(req, fields)) {
    res.writeHead(403).end()

    return
  }

  if (counts(fields)) {
    deliveredSids.add(fields.get("MessageSid") ?? "")
    delivered++
  }

  res.writeHead(204).end()
}

/** The pages the forms post to, by path. */
const FORMS: Readonly<Record<string, (fields: URLSearchParams) => Promise<string>>> = {
  "/phone": (fields) => sendCode(fields.get("phone") ?? ""),
  "/confirm": (fields) => confirm(fields.get("phone") ?? "", fields.get("code") ?? ""),
}

const html = (res: ServerResponse, markup: string) =>
  res.writeHead(200, { "content-type": "text/html" }).end(markup)

async function route(req: IncomingMessage, body: string, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return void html(res, start())

  const fields = new URLSearchParams(body)
  const form = FORMS[req.url ?? ""]

  if (form === undefined) return onStatus(req, fields, res)
  html(res, await form(fields))
}

createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    route(req, body, res).catch(() => res.writeHead(500).end())
  })
}).listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
