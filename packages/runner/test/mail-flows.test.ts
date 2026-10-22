/**
 * Sign-up flows that need a value the app sends or makes: a code read from an emailed message, a
 * sign-in link clicked in the email itself, and an authenticator code. Each records where the
 * value came from, never the value, so it replays on a fresh run, with fresh values, at 0 model
 * calls.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, unique, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { resendMail } from "../src/mail/index.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"
import { AUTHENTICATOR_KEY, type SignupSite, startSignupSite } from "./fixtures/signup-site.ts"

let site: SignupSite
let dir: string
let counter = 0

beforeAll(async () => {
  site = await startSignupSite()
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-mail-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A new address for each run, as a real sign-up needs. */
function freshEmail(): string {
  counter++

  return `ada+${counter}@signup.test`
}

async function withSession<T>(
  options: Partial<WebSessionOptions> & { readonly path?: string },
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const { path = "/", ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    cache: { dir, mode: "read-write", journey: "mail" },
    mail: [resendMail(site.resend)],
    secrets: { authenticator: { value: AUTHENTICATOR_KEY, purpose: "totp" } },
    ...rest,
  })

  try {
    await session.app.open(path)

    return await run(session)
  } finally {
    await session.close()
  }
}

/** The address the step's params name, read back from the conversation. */
function emailIn(conversation: string): string {
  return /ada\+\d+@signup\.test/.exec(conversation)?.[0] ?? ""
}

const SIGN_UP: readonly Move[] = [
  (view, talk) => ["fill", { ref: ref(view, "textbox", "Email"), text: emailIn(talk) }],
  (view) => ["click", { ref: ref(view, "button", "Send code") }],
]

/** Every recording file's text, to check what the cache holds. */
async function recordings(): Promise<string> {
  const files = await readdir(dir)

  return (await Promise.all(files.map((file) => readFile(join(dir, file), "utf8")))).join("\n")
}

describe("a code from mail", () => {
  it("reads the code with read_mail, records where it came from, and replays on a new address", async () => {
    const actor = scripted([
      ...SIGN_UP,
      (_view, talk) => ["read_mail", { to: emailIn(talk), pick: "code" }],
      (view, talk) => [
        "fill",
        { ref: ref(view, "textbox", "Code"), text: /the code is (\d+)/.exec(talk)?.[1] ?? "" },
      ],
      (view) => ["click", { ref: ref(view, "button", "Verify") }],
    ])
    const first = freshEmail()

    await withSession({ model: actor }, async (session) => {
      await session.agent.act("sign up as {email} with the emailed code", {
        params: { email: unique(first) },
      })
      await session
        .expect(session.screen.getByRole("heading", { name: `Welcome, ${first}` }))
        .toBeVisible()
    })

    const cached = await recordings()

    expect(cached).toContain('"mail"')
    expect(cached).toContain('"param": "email"')
    expect(cached).not.toMatch(/"text": "\d{6}"/)

    const idle = scripted([])
    const second = freshEmail()

    await withSession({ model: idle }, async (session) => {
      await session.agent.act("sign up as {email} with the emailed code", {
        params: { email: unique(second) },
      })
      await session
        .expect(session.screen.getByRole("heading", { name: `Welcome, ${second}` }))
        .toBeVisible()
    })

    expect(idle.doGenerateCalls).toHaveLength(0)
  })

  it("gives a test the code and the link through session.mail", async () => {
    const email = freshEmail()

    await withSession({}, async (session) => {
      await session.screen.getByLabel("Email").fill(email)
      await session.screen.getByRole("button", { name: "Send code" }).click()

      const code = await session.mail.code(email)

      expect(code).toMatch(/^\d{6}$/)
      expect(await session.mail.link(email, { match: "magic" })).toMatch(/\/magic\?token=\d+$/)

      await session.screen.getByLabel("Code").fill(code)
      await session.screen.getByRole("button", { name: "Verify" }).click()
      await session
        .expect(session.screen.getByRole("heading", { name: `Welcome, ${email}` }))
        .toBeVisible()
    })
  })
})

describe("a link in the email", () => {
  it("opens the email in the browser, clicks its link, and replays it with no model", async () => {
    const actor = scripted([
      ...SIGN_UP,
      (_view, talk) => ["open_mail", { to: emailIn(talk) }],
      (view) => ["click", { ref: ref(view, "link", "Sign in") }],
    ])

    await withSession({ model: actor }, async (session) => {
      await session.agent.act("sign up as {email} and follow the emailed link", {
        params: { email: unique(freshEmail()) },
      })
      await session
        .expect(session.screen.getByRole("heading", { name: "Signed in by link" }))
        .toBeVisible()
    })

    const idle = scripted([])

    await withSession({ model: idle }, async (session) => {
      await session.agent.act("sign up as {email} and follow the emailed link", {
        params: { email: unique(freshEmail()) },
      })
      await session
        .expect(session.screen.getByRole("heading", { name: "Signed in by link" }))
        .toBeVisible()
    })

    expect(idle.doGenerateCalls).toHaveLength(0)
  })
})

describe("an authenticator code", () => {
  it("fills the code of the moment from a totp secret, and replays with no model", async () => {
    const actor = scripted([
      (view) => [
        "fill_secret",
        { ref: ref(view, "textbox", "Authentication code"), secret: "authenticator" },
      ],
      (view) => ["click", { ref: ref(view, "button", "Confirm") }],
    ])

    await withSession({ model: actor, path: "/2fa" }, async (session) => {
      await session.agent.act("pass the two-factor check")
      await session
        .expect(session.screen.getByRole("heading", { name: "Two-factor passed" }))
        .toBeVisible()
    })

    expect(await recordings()).not.toContain(AUTHENTICATOR_KEY)

    const idle = scripted([])

    await withSession({ model: idle, path: "/2fa" }, async (session) => {
      await session.agent.act("pass the two-factor check")
      await session
        .expect(session.screen.getByRole("heading", { name: "Two-factor passed" }))
        .toBeVisible()
    })

    expect(idle.doGenerateCalls).toHaveLength(0)
  })
})
