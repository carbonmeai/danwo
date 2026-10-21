import { afterEach, describe, expect, it } from "vitest"

import { clerkInstance, connectClerkUpstream } from "../src/clerk/index.ts"
import { createEmulator, type Emulator } from "../src/define.ts"
import { google, seedGoogle } from "../src/google/index.ts"
import { clerkTestbed, frontend } from "./clerk-client.ts"

const FAPI = "https://danwo-app.clerk.accounts.dev"
const APP = "http://127.0.0.1:4100"
const CLIENT = { client_id: "clerk-google.apps.test", client_secret: "clerk-google-secret" }

let bed: ReturnType<typeof clerkTestbed>
let googleEmulator: Emulator

afterEach(() => bed.close())

/** A Clerk instance offering "Continue with Google", connected to a Google emulator with Lin. */
function socialBed(users: { email: string; firstName?: string }[] = []) {
  bed = clerkTestbed({
    social: [
      { provider: "google", clientId: CLIENT.client_id, clientSecret: CLIENT.client_secret },
    ],
    users,
  })
  googleEmulator = createEmulator(google)
  seedGoogle(googleEmulator.store, {
    users: [{ email: "lin@danwo.test", name: "Lin Wu" }],
    oauth_clients: [{ ...CLIENT, name: "Clerk", redirect_uris: [`${FAPI}/v1/oauth_callback`] }],
  })
  connectClerkUpstream(bed.emulator, (request) => googleEmulator.fetch(request))

  return frontend(bed.emulator, APP)
}

/** Plays the browser on Google's chooser: picks the only account, and follows the redirect back. */
async function chooseAccount(authorize: string): Promise<URL> {
  const page = await googleEmulator.fetch(new Request(authorize))
  const html = await page.text()
  const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ""
  const user = /name="user" value="([^"]+)"/.exec(html)?.[1] ?? ""
  const back = await googleEmulator.fetch(
    new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, user }),
    }),
  )

  return new URL(back.headers.get("location") ?? "")
}

describe("Clerk social sign-in with Google", () => {
  it("offers Google in the environment, with PKCE on the authorization URL", async () => {
    const fapi = socialBed()
    const dvb = await fapi.devBrowser()
    const environment = await fapi.call("/v1/environment", { devBrowser: dvb })

    expect(environment.body).toMatchObject({
      user_settings: { social: { oauth_google: { enabled: true, strategy: "oauth_google" } } },
    })

    const started = await fapi.call("/v1/client/sign_ins", {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "oauth_google", redirect_url: `${APP}/sign-in/sso-callback` },
    })
    const authorize = new URL(
      String(
        fapi.at(
          started.body,
          "response",
          "first_factor_verification",
          "external_verification_redirect_url",
        ),
      ),
    )

    expect(authorize.origin).toBe("https://accounts.google.com")
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${FAPI}/v1/oauth_callback`)
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256")
  })

  it("turns a first Google sign-in into a sign-up, as ClerkJS's transfer does", async () => {
    const fapi = socialBed()
    const dvb = await fapi.devBrowser()
    const started = await fapi.call("/v1/client/sign_ins", {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "oauth_google", redirect_url: `${APP}/sign-in/sso-callback` },
    })
    const back = await chooseAccount(
      String(
        fapi.at(
          started.body,
          "response",
          "first_factor_verification",
          "external_verification_redirect_url",
        ),
      ),
    )

    expect(back.href.startsWith(`${FAPI}/v1/oauth_callback`)).toBe(true)

    const callback = await bed.emulator.fetch(new Request(back))

    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe(`${APP}/sign-in/sso-callback`)

    const client = await fapi.call("/v1/client", { devBrowser: dvb })

    expect(fapi.at(client.body, "response", "sign_in", "first_factor_verification")).toMatchObject({
      status: "transferable",
      error: { code: "external_account_not_found" },
    })

    const transfer = await fapi.call("/v1/client/sign_ups", {
      method: "POST",
      devBrowser: dvb,
      form: { transfer: "true" },
    })

    expect(fapi.at(transfer.body, "response")).toMatchObject({ status: "complete" })

    const lin = clerkInstance(bed.emulator).user("lin@danwo.test")

    expect(lin).toMatchObject({ first_name: "Lin", last_name: "Wu" })
    expect(lin?.external_accounts).toMatchObject([{ provider: "oauth_google" }])
    expect(fapi.at(transfer.body, "client", "sessions")).toHaveLength(1)
  })

  it("signs a user with that email in, and links Google to them", async () => {
    const fapi = socialBed([{ email: "lin@danwo.test", firstName: "Lin" }])
    const dvb = await fapi.devBrowser()
    const started = await fapi.call("/v1/client/sign_ins", {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "oauth_google", redirect_url: `${APP}/sign-in/sso-callback` },
    })
    const back = await chooseAccount(
      String(
        fapi.at(
          started.body,
          "response",
          "first_factor_verification",
          "external_verification_redirect_url",
        ),
      ),
    )

    await bed.emulator.fetch(new Request(back))

    const client = await fapi.call("/v1/client", { devBrowser: dvb })

    expect(fapi.at(client.body, "response", "sign_in")).toMatchObject({ status: "complete" })
    expect(fapi.at(client.body, "response", "sessions")).toHaveLength(1)
    expect(clerkInstance(bed.emulator).users()).toHaveLength(1)
    expect(clerkInstance(bed.emulator).user("lin@danwo.test")?.external_accounts).toHaveLength(1)
  })

  it("refuses a callback whose state it never issued", async () => {
    socialBed()

    const callback = await bed.emulator.fetch(
      new Request(`${FAPI}/v1/oauth_callback?code=x&state=forged`),
    )

    expect(callback.status).toBe(400)
  })
})
