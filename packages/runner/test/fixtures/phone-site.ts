/**
 * A sign-up app that checks your phone number with a texted code, through Twilio Verify. It talks
 * to the Twilio emulator in-process, so tests read the texts where the emulator keeps them.
 */
import type { IncomingMessage } from "node:http"
import { text } from "node:stream/consumers"

import { createEmulator, type Emulator, seedTwilio, twilio } from "@danwo/emulators"
import { z } from "zod"

import { serveForms } from "./html-server.ts"

const ACCOUNT = "REDACTED-TEST-VALUE"
const TOKEN = "00000000000000000000000000000001"
const SERVICE = "REDACTED-TEST-VALUE"
const AUTH = `Basic ${Buffer.from(`${ACCOUNT}:${TOKEN}`).toString("base64")}`

const page = (title: string, body: string) =>
  `<!doctype html><title>${title}</title><main><h1>${title}</h1>${body}</main>`

const START = page(
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

/** The part of Verify's answer the app reads. */
const Checked = z.object({ status: z.string() })

export interface PhoneSite {
  readonly url: string
  readonly twilio: Emulator
  close(): Promise<void>
}

export async function startPhoneSite(): Promise<PhoneSite> {
  const emulator = createEmulator(twilio)

  seedTwilio(emulator.store, {
    accounts: [{ sid: ACCOUNT, authToken: TOKEN }],
    verifyServices: [{ sid: SERVICE, friendlyName: "Phone site" }],
  })

  /** A Verify call, answered with its JSON. */
  async function verify(path: string, fields: Record<string, string>): Promise<unknown> {
    const reply = await emulator.fetch(
      new Request(`https://verify.twilio.com/v2/Services/${SERVICE}/${path}`, {
        method: "POST",
        headers: { authorization: AUTH, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
    )

    return reply.json()
  }

  async function pageFor(req: IncomingMessage): Promise<string> {
    if (req.method !== "POST") return START

    const fields = new URLSearchParams(await text(req))
    const phone = fields.get("phone") ?? ""

    if (req.url === "/phone") {
      await verify("Verifications", { To: phone, Channel: "sms" })

      return codePage(phone)
    }

    const checked = Checked.parse(
      await verify("VerificationCheck", { To: phone, Code: fields.get("code") ?? "" }),
    )

    return page(checked.status === "approved" ? `Verified ${phone}` : "Wrong code", "")
  }

  const server = await serveForms(pageFor)

  return {
    url: server.url,
    twilio: emulator,
    close: async () => {
      await server.close()
      await emulator.close()
    },
  }
}
