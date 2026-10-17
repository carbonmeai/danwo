import { type Emulator, googleSignIns, outlookMailbox, s3Objects } from "@danwo/emulators"
import { describe, expect, it } from "vitest"

import { defaultOutboundFaults } from "../src/runner/faults.ts"
import { googleService, microsoftService } from "../src/runner/oauth.ts"
import { s3Service } from "../src/runner/s3.ts"
import { startServices } from "../src/runner/services.ts"
import { stripeService } from "../src/runner/stripe.ts"

describe("startServices", () => {
  it("puts several services behind one proxy and resets them together", async () => {
    const stripe = stripeService()
    const s3 = s3Service({ seed: { buckets: [{ name: "uploads" }] } })
    const services = await startServices([stripe, s3])

    try {
      expect(Object.keys(services.fixtures).toSorted()).toEqual(["proxy", "s3", "settle", "stripe"])
      expect(services.webhooks).toEqual({ stripe: stripe.emulator.webhooks })

      const put = await s3.emulator.fetch(
        new Request("https://uploads.t3.storage.dev/a.txt", {
          method: "PUT",
          body: "hi",
          headers: {
            authorization:
              "AWS4-HMAC-SHA256 Credential=k/20260101/auto/s3/aws4_request, SignedHeaders=host, Signature=0",
          },
        }),
      )

      expect(put.status).toBe(200)
      expect(s3Objects(s3.emulator).list("uploads")).toHaveLength(1)

      await services.reset()
      expect(s3Objects(s3.emulator).buckets()).toEqual(["uploads"])
      expect(s3Objects(s3.emulator).list("uploads")).toEqual([])
    } finally {
      await services.close()
    }
  })
})

const CLIENT = {
  client_id: "123-app.apps.googleusercontent.com",
  client_secret: "GOCSPX-app-secret",
  name: "Danwo App",
  redirect_uris: ["https://app.danwo.test/auth/google/callback"],
}

/** Picks Ada on Google's account chooser and redeems the code, as an app and its browser would. */
async function signInAsAda(google: Emulator): Promise<number> {
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth")

  authorize.search = new URLSearchParams({
    client_id: CLIENT.client_id,
    redirect_uri: CLIENT.redirect_uris[0] ?? "",
    response_type: "code",
    scope: "openid email",
  }).toString()
  const page = await (await google.fetch(new Request(authorize))).text()
  const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(page)?.[1] ?? ""
  const action = /<form method="post" action="([^"]+)"/.exec(page)?.[1] ?? ""
  const back = await google.fetch(
    new Request(new URL(action, authorize), {
      method: "POST",
      body: new URLSearchParams({ request: field("request"), user: field("user") }),
    }),
  )
  const code = new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? ""
  const token = await google.fetch(
    new Request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CLIENT.redirect_uris[0] ?? "",
        client_id: CLIENT.client_id,
        client_secret: CLIENT.client_secret,
      }),
    }),
  )

  return token.status
}

describe("googleService", () => {
  it("joins Stripe behind one proxy with its own pushes, records who signed in, and reseeds on reset", async () => {
    const stripe = stripeService()
    const google = googleService({
      seed: { users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }], oauth_clients: [CLIENT] },
    })
    const services = await startServices([stripe, google])

    try {
      expect(Object.keys(services.fixtures).toSorted()).toEqual([
        "google",
        "proxy",
        "settle",
        "stripe",
      ])
      // Google's push notifications reach the matrix next to Stripe's webhooks.
      expect(services.webhooks).toEqual({
        stripe: stripe.emulator.webhooks,
        google: google.emulator.webhooks,
      })
      expect(await signInAsAda(google.emulator)).toBe(200)
      expect(googleSignIns(google.emulator).latest(CLIENT.client_id)).toMatchObject({
        email: "ada@danwo.test",
        redeemed: true,
        accessTokens: 1,
      })

      await services.reset()
      expect(googleSignIns(google.emulator).list()).toEqual([])
      // The client and user are seeded again, so a fresh sign-in works after the reset.
      expect(await signInAsAda(google.emulator)).toBe(200)
    } finally {
      await services.close()
    }
  })

  it("gives sign-in hosts Google's and Microsoft's faults in the default catalogue", () => {
    const token = defaultOutboundFaults({
      host: "oauth2.googleapis.com",
      method: "POST",
      path: "/token",
      index: 0,
    })
    const chooser = defaultOutboundFaults({
      host: "accounts.google.com",
      method: "GET",
      path: "/o/oauth2/v2/auth",
      index: 0,
    })
    const microsoftToken = defaultOutboundFaults({
      host: "login.microsoftonline.com",
      method: "POST",
      path: "/common/oauth2/v2.0/token",
      index: 0,
    })

    expect(token.map((f) => f.kind)).toEqual([
      "status",
      "status",
      "status",
      "delay",
      "reset",
      "reset-after",
    ])
    // The browser's account chooser is not faulted.
    expect(chooser).toEqual([])
    expect(microsoftToken.length).toBeGreaterThan(0)
  })
})

describe("microsoftService", () => {
  it("seeds from a function on every reset and hands its notifications to the matrix", async () => {
    let subject = "first"
    const microsoft = microsoftService({
      seed: () => ({
        users: [{ email: "grace@danwo.test", name: "Grace Hopper" }],
        mail: [{ user: "grace@danwo.test", subject }],
      }),
    })
    const services = await startServices([microsoft])

    try {
      expect(services.webhooks).toEqual({ microsoft: microsoft.emulator.webhooks })
      expect(outlookMailbox(microsoft.emulator, "grace@danwo.test").latest("inbox")?.subject).toBe(
        "first",
      )

      subject = "after reset"
      await services.reset()
      expect(outlookMailbox(microsoft.emulator, "grace@danwo.test").latest("inbox")?.subject).toBe(
        "after reset",
      )
    } finally {
      await services.close()
    }
  })
})
