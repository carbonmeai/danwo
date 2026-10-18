/**
 * Phone verification with a texted code: the agent reads the code from the text Twilio Verify sent,
 * the recording keeps where the code came from (the newest text to the step's phone number), and a
 * replay on a new phone number reads the new code with no model call.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession, unique } from "../src/index.ts"
import { twilioSms } from "../src/mail/index.ts"
import { startPhoneSite, type PhoneSite } from "./fixtures/phone-site.ts"
import { ref, scripted } from "./fixtures/scripted.ts"

let site: PhoneSite
let dir: string

beforeAll(async () => {
  site = await startPhoneSite()
  dir = await mkdtemp(join(tmpdir(), "danwo-sms-"))
})

afterAll(async () => {
  await site.close()
  await rm(dir, { recursive: true, force: true })
})

/** The phone number the step's params name, read back from the conversation. */
const phoneIn = (talk: string) => /\+1555\d{7}/.exec(talk)?.[0] ?? ""

/** Signs up as `phone` with the texted code, driven by `model`. */
async function signUp(phone: string, model: ReturnType<typeof scripted>): Promise<void> {
  const session = await openWebSession({
    baseUrl: site.url,
    model,
    cache: { dir, mode: "read-write", journey: "sms" },
    mail: [twilioSms(site.twilio)],
  })

  try {
    await session.app.open("/")
    await session.agent.act("verify the phone {phone} with the texted code", {
      params: { phone: unique(phone) },
    })
    await session
      .expect(session.screen.getByRole("heading", { name: `Verified ${phone}` }))
      .toBeVisible()
  } finally {
    await session.close()
  }
}

describe("a code from a text message", () => {
  it("reads the texted code with read_mail and replays on a new phone number with no model", async () => {
    const actor = scripted([
      (view, talk) => ["fill", { ref: ref(view, "textbox", "Phone"), text: phoneIn(talk) }],
      (view) => ["click", { ref: ref(view, "button", "Send code") }],
      (_view, talk) => ["read_mail", { to: phoneIn(talk), pick: "code" }],
      (view, talk) => [
        "fill",
        { ref: ref(view, "textbox", "Code"), text: /the code is (\d+)/.exec(talk)?.[1] ?? "" },
      ],
      (view) => ["click", { ref: ref(view, "button", "Verify") }],
    ])

    await signUp("+15550000001", actor)

    const files = await readdir(dir)
    const cached = (await Promise.all(files.map((file) => readFile(join(dir, file), "utf8")))).join(
      "\n",
    )

    expect(cached).toContain('"mail"')
    expect(cached).toContain('"param": "phone"')
    expect(cached).not.toMatch(/"text": "\d{6}"/)

    const idle = scripted([])

    await signUp("+15550000002", idle)

    expect(idle.doGenerateCalls).toHaveLength(0)
  })
})
