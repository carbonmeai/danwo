/**
 * A sign-up app that proves who you are three ways: a code it emails you, a sign-in link it
 * emails you, and an authenticator code. It sends its mail through the Resend emulator, so tests
 * read the mail where the emulator caught it.
 */
import { randomInt } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { text } from "node:stream/consumers"

import { createEmulator, type Emulator, resend } from "@danwo/emulators"

import { totp } from "../../src/secrets/totp.ts"
import { serveForms } from "./html-server.ts"

/** The authenticator key the app shares with its one user, in base32. */
export const AUTHENTICATOR_KEY = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"

const page = (title: string, body: string) =>
  `<!doctype html><title>${title}</title><main><h1>${title}</h1>${body}</main>`

const SIGN_UP = page(
  "Sign up",
  `<form method="post" action="/signup">
    <label>Email <input name="email" type="email"></label>
    <button type="submit">Send code</button>
  </form>`,
)

const verifyPage = (email: string) =>
  page(
    "Check your email",
    `<p>We sent a code to your inbox.</p>
    <form method="post" action="/verify">
      <input type="hidden" name="email" value="${email}">
      <label>Code <input name="code" autocomplete="one-time-code"></label>
      <button type="submit">Verify</button>
    </form>`,
  )

const TWO_FACTOR = page(
  "Two-factor check",
  `<form method="post" action="/2fa">
    <label>Authentication code <input name="code" autocomplete="one-time-code"></label>
    <button type="submit">Confirm</button>
  </form>`,
)

export interface SignupSite {
  readonly url: string
  readonly resend: Emulator
  close(): Promise<void>
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await text(req))
}

export async function startSignupSite(): Promise<SignupSite> {
  const mail = createEmulator(resend)
  const codes = new Map<string, string>()
  const links = new Map<string, string>()
  let url = ""

  async function sendCode(email: string): Promise<void> {
    const code = String(randomInt(100_000, 1_000_000))
    const token = String(randomInt(1e9, 1e10))

    codes.set(email, code)
    links.set(token, email)
    await mail.fetch(
      new Request("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: "Bearer re_test", "content-type": "application/json" },
        body: JSON.stringify({
          from: "hello@signup.test",
          to: [email],
          subject: "Your sign-up code",
          text: `Your code is ${code}. Or sign in with ${url}/magic?token=${token}`,
          html: `<p>Your code is <b>${code}</b>.</p><p><a href="${url}/magic?token=${token}">Sign in</a></p>`,
        }),
      }),
    )
  }

  /** What each form posts to, answered from its fields. */
  const posts: Readonly<Record<string, (fields: URLSearchParams) => Promise<string> | string>> = {
    "/signup": async (fields) => {
      const email = fields.get("email") ?? ""

      await sendCode(email)

      return verifyPage(email)
    },
    "/verify": (fields) => {
      const email = fields.get("email") ?? ""

      return codes.get(email) === fields.get("code")
        ? page(`Welcome, ${email}`, "")
        : page("Wrong code", "")
    },
    "/2fa": (fields) =>
      page(
        fields.get("code") === totp(AUTHENTICATOR_KEY)
          ? "Two-factor passed"
          : "Wrong authentication code",
        "",
      ),
  }

  async function answer(req: IncomingMessage, path: string): Promise<string> {
    const post = req.method === "POST" ? posts[path] : undefined

    return post === undefined ? answerGet(path) : post(await form(req))
  }

  function answerGet(path: string): string {
    const at = new URL(path, "http://site")

    if (at.pathname === "/magic")
      return links.has(at.searchParams.get("token") ?? "")
        ? page("Signed in by link", "")
        : page("Link expired", "")

    return at.pathname === "/2fa" ? TWO_FACTOR : SIGN_UP
  }

  const server = await serveForms((req) => answer(req, req.url ?? "/"))

  url = server.url

  return { url, resend: mail, close: () => server.close() }
}
