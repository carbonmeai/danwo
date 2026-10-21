import { once } from "node:events"
import { createServer, type IncomingHttpHeaders } from "node:http"

import {
  auth0Tenant,
  clerkInstance,
  type Emulator,
  githubRepo,
  googleSignIns,
  listeningPort,
  outlookMailbox,
  paystackLedger,
  s3Objects,
  slackWorkspace,
  stableClerkId,
  twilioInbox,
  twilioPhone,
} from "@danwo/emulators"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { clerkService } from "../src/runner/clerk.ts"
import { defaultOutboundFaults } from "../src/runner/faults.ts"
import {
  auth0Service,
  githubService,
  googleService,
  microsoftService,
  paystackService,
  slackService,
  twilioService,
} from "../src/runner/oauth.ts"
import { s3Service } from "../src/runner/s3.ts"
import { startServices } from "../src/runner/services.ts"
import { stripeService } from "../src/runner/stripe.ts"
import { fakeKey } from "./fake-key.ts"

/** The default catalogue's faults for a POST to `host` at `path`. */
function postFaults(host: string, path: string) {
  return defaultOutboundFaults({ method: "POST", host, path, index: 0 })
}

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

interface Received {
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

/** A local receiver for the deliveries an emulator sends, answering 200 to each. */
async function receiver(): Promise<{ url: string; received: Received[]; close(): void }> {
  const received: Received[] = []
  const server = createServer((req, res) => {
    let body = ""

    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body })
      res.end()
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${listeningPort(server)}`,
    received,
    close: () => server.close(),
  }
}

describe("slackService and githubService", () => {
  it("join Stripe behind one proxy, deliver signed events on settle, and reseed on reset", async () => {
    const app = await receiver()
    const stripe = stripeService()
    const slack = slackService({
      seed: () => ({
        users: [{ name: "ada" }],
        apps: [
          {
            name: "Echo",
            client_id: "1.2",
            client_secret: "echo-secret",
            signing_secret: "echo-signing",
            bot_scopes: ["channels:history", "chat:write"],
            events: { url: `${app.url}/slack/events`, bot_events: ["message.channels"] },
          },
        ],
        installations: [{ app: "Echo", bot_token: "xoxb-echo", channels: ["general"] }],
      }),
    })
    const github = githubService({
      seed: () => ({
        users: [{ login: "ada" }],
        repos: [{ repo: "ada/widgets" }],
        tokens: [{ token: fakeKey("ghp_", "adaAdaAdaAdaAdaAdaAda01"), login: "ada" }],
        hooks: [
          {
            repo: "ada/widgets",
            url: `${app.url}/github`,
            secret: "hook-secret",
            events: ["issues"],
          },
        ],
      }),
    })
    const services = await startServices([stripe, slack, github])

    try {
      expect(Object.keys(services.fixtures).toSorted()).toEqual([
        "github",
        "proxy",
        "settle",
        "slack",
        "stripe",
      ])
      expect(services.webhooks).toEqual({
        stripe: stripe.emulator.webhooks,
        slack: slack.emulator.webhooks,
        github: github.emulator.webhooks,
      })

      slackWorkspace(slack.emulator).post("ada", "general", "hi")

      const opened = await github.emulator.fetch(
        new Request("https://api.github.com/repos/ada/widgets/issues", {
          method: "POST",
          headers: { authorization: `token ${fakeKey("ghp_", "adaAdaAdaAdaAdaAdaAda01")}` },
          body: JSON.stringify({ title: "It broke" }),
        }),
      )

      expect(opened.status).toBe(201)
      await services.settle()

      const slackEvent = app.received.find((r) => r.path === "/slack/events")
      const githubEvent = app.received.find((r) => r.path === "/github")

      expect(slackEvent?.headers["x-slack-signature"]).toMatch(/^v0=/)
      expect(githubEvent?.headers["x-github-event"]).toBe("issues")
      expect(githubEvent?.headers["x-hub-signature-256"]).toMatch(/^sha256=/)

      await services.reset()
      expect(slackWorkspace(slack.emulator).messages("general")).toEqual([])
      expect(githubRepo(github.emulator, "ada/widgets").issues()).toEqual([])
    } finally {
      await services.close()
      app.close()
    }
  })

  it("gives Slack and GitHub hosts their own faults in the default catalogue", () => {
    const slackFaults = defaultOutboundFaults({
      method: "POST",
      host: "slack.com",
      path: "/api/chat.postMessage",
      index: 0,
    })
    const githubFaults = defaultOutboundFaults({
      method: "POST",
      host: "api.github.com",
      path: "/repos/ada/widgets/issues",
      index: 0,
    })

    expect(slackFaults.some((f) => f.kind === "status" && f.status === 429)).toBe(true)
    expect(githubFaults.some((f) => f.kind === "status" && f.status === 403)).toBe(true)
  })

  it("gives Gemini, Perplexity and Bedrock hosts the model API faults, in each one's own shape", () => {
    const gemini = postFaults(
      "generativelanguage.googleapis.com",
      "/v1beta/models/m:generateContent",
    ).find((f) => f.kind === "status" && f.status === 429)
    const bedrock = postFaults("bedrock-runtime.eu-west-1.amazonaws.com", "/model/m/converse").find(
      (f) => f.kind === "status" && f.status === 429,
    )
    const perplexity = postFaults("api.perplexity.ai", "/v1/agent")

    expect(gemini?.kind === "status" && JSON.parse(gemini.body ?? "{}")).toMatchObject({
      error: { code: 429, status: "RESOURCE_EXHAUSTED" },
    })
    expect(bedrock?.kind === "status" && bedrock.headers?.["x-amzn-errortype"]).toBe(
      "ThrottlingException",
    )
    expect(perplexity.some((f) => f.kind === "emulate" && f.behaviour === "stream-cut")).toBe(true)
  })
})

describe("twilioService", () => {
  const ACCOUNT = fakeKey("AC", "0000000000000000000000000000000a")
  const TOKEN = "0000000000000000000000000000000a"
  const AUTH = `Basic ${Buffer.from(`${ACCOUNT}:${TOKEN}`).toString("base64")}`

  it("joins Stripe behind one proxy, plays status callbacks and texts on settle, and reseeds on reset", async () => {
    const app = await receiver()
    const twilio = twilioService({
      seed: () => ({
        accounts: [{ sid: ACCOUNT, authToken: TOKEN }],
        numbers: [{ number: "+15005550006", smsUrl: `${app.url}/sms` }],
      }),
    })
    const services = await startServices([stripeService(), twilio])

    try {
      expect(Object.keys(services.webhooks ?? {}).toSorted()).toEqual(["stripe", "twilio"])

      const sent = await twilio.emulator.fetch(
        new Request(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`, {
          method: "POST",
          headers: { authorization: AUTH, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            From: "+15005550006",
            To: "+14155550123",
            Body: "Your code is 123456",
            StatusCallback: `${app.url}/status`,
          }).toString(),
        }),
      )

      expect(sent.status).toBe(201)
      twilioPhone(twilio.emulator).send("+14155550123", "+15005550006", "STOP")
      await services.settle()

      const statuses = app.received
        .filter((r) => r.path === "/status")
        .map((r) => new URLSearchParams(r.body).get("MessageStatus"))

      expect(statuses).toEqual(["sent", "delivered"])
      expect(
        app.received.find((r) => r.path === "/sms")?.headers["x-twilio-signature"],
      ).toBeTruthy()
      expect(twilioInbox(twilio.emulator).latest("+14155550123")?.code()).toBe("123456")

      await services.reset()
      expect(twilioInbox(twilio.emulator).list()).toEqual([])
    } finally {
      await services.close()
      app.close()
    }
  })

  it("gives Twilio hosts Twilio's faults in the default catalogue", () => {
    const faults = defaultOutboundFaults({
      method: "POST",
      host: "verify.twilio.com",
      path: "/v2/Services/VA1/VerificationCheck",
      index: 0,
    })

    expect(faults.some((f) => f.kind === "status" && f.body?.includes("20429"))).toBe(true)
  })
})

/** The faults the default catalogue plans for a POST to `host` and `path`. */
function faultsAt(host: string, path: string) {
  return defaultOutboundFaults({ method: "POST", host, path, index: 0 })
}

describe("paystackService", () => {
  const SECRET = fakeKey("sk_test_", "00000000000000000000000000000000000000aa")

  it("joins Stripe behind one proxy, plays signed events on settle, and reseeds on reset", async () => {
    const app = await receiver()
    const paystack = paystackService({
      seed: () => ({ integrations: [{ secretKey: SECRET, webhookUrl: `${app.url}/paystack` }] }),
    })
    const services = await startServices([stripeService(), paystack])

    try {
      expect(Object.keys(services.webhooks ?? {}).toSorted()).toEqual(["paystack", "stripe"])

      const started = await paystack.emulator.fetch(
        new Request("https://api.paystack.co/transaction/initialize", {
          method: "POST",
          headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@shop.test", amount: 500_000 }),
        }),
      )
      const page = z
        .object({ data: z.object({ authorization_url: z.string() }) })
        .parse(await started.json()).data

      await paystack.emulator.fetch(
        new Request(`${page.authorization_url}/card`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ number: "4084084084084081", expiry: "12/30", cvv: "408" }),
        }),
      )
      await services.settle()

      expect(app.received.map((r) => r.headers["x-paystack-signature"] !== undefined)).toEqual([
        true,
      ])
      expect(paystackLedger(paystack.emulator).paidTotal("ada@shop.test")).toBe(500_000)

      await services.reset()
      expect(paystackLedger(paystack.emulator).transactions()).toEqual([])
    } finally {
      await services.close()
      app.close()
    }
  })

  it("gives Paystack's API its faults and leaves the hosted page alone", () => {
    expect(faultsAt("api.paystack.co", "/transaction/initialize").length).toBeGreaterThan(0)
    expect(faultsAt("checkout.paystack.com", "/abc/card")).toEqual([])
  })
})

describe("auth0Service", () => {
  const tenant = {
    domain: "acme.us.auth0.com",
    custom_domains: ["login.acme.test"],
    clients: [
      {
        client_id: "web",
        client_secret: "web-secret",
        name: "Web",
        callbacks: ["https://app.danwo.test/callback"],
      },
    ],
    connections: [
      { name: "google-oauth2", client_id: CLIENT.client_id, client_secret: CLIENT.client_secret },
    ],
  }

  it("answers tenant and custom domains and hands social logins to the Google service", async () => {
    const google = googleService({
      seed: {
        users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }],
        oauth_clients: [{ ...CLIENT, redirect_uris: ["https://acme.us.auth0.com/login/callback"] }],
      },
    })
    const auth0 = auth0Service({ seed: { tenants: [tenant] }, social: [google] })
    const services = await startServices([auth0, google])

    try {
      expect(Object.keys(services.fixtures).toSorted()).toEqual([
        "auth0",
        "google",
        "proxy",
        "settle",
      ])
      expect(auth0.routes[0]?.hosts).toEqual(
        expect.arrayContaining(["*.auth0.com", "login.acme.test"]),
      )

      const authorize = new URL("https://acme.us.auth0.com/authorize")

      authorize.search = new URLSearchParams({
        client_id: "web",
        redirect_uri: "https://app.danwo.test/callback",
        response_type: "code",
        scope: "openid email",
      }).toString()

      const toLogin = await auth0.emulator.fetch(new Request(authorize, { redirect: "manual" }))
      const state = new URL(toLogin.headers.get("location") ?? "", authorize).searchParams.get(
        "state",
      )
      const toGoogle = await auth0.emulator.fetch(
        new Request(
          `https://acme.us.auth0.com/authorize/social?state=${state}&connection=google-oauth2`,
        ),
      )
      const chooser = new URL(toGoogle.headers.get("location") ?? "")
      const page = await (await google.emulator.fetch(new Request(chooser))).text()
      const field = (name: string) =>
        new RegExp(`name="${name}" value="([^"]+)"`).exec(page)?.[1] ?? ""
      const picked = await google.emulator.fetch(
        new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
          method: "POST",
          body: new URLSearchParams({ request: field("request"), user: field("user") }),
        }),
      )
      const back = await auth0.emulator.fetch(new Request(picked.headers.get("location") ?? ""))

      expect(new URL(back.headers.get("location") ?? "").searchParams.get("code")).toBeTruthy()
      expect(auth0Tenant(auth0.emulator).user("ada@danwo.test")?.user_id).toMatch(
        /^google-oauth2\|/,
      )
    } finally {
      await services.close()
    }
  })

  it("gives tenant domains Auth0's faults and leaves the login pages alone", () => {
    expect(faultsAt("acme.us.auth0.com", "/oauth/token").map((f) => f.kind)).toContain(
      "reset-after",
    )
    expect(faultsAt("acme.eu.auth0.com", "/api/v2/users").length).toBeGreaterThan(0)
    expect(faultsAt("acme.us.auth0.com", "/u/login")).toEqual([])
  })
})

describe("clerkService", () => {
  it("delivers svix-signed user webhooks on settle and hands its codes to the mail fixture", async () => {
    const hooks = await receiver()
    const clerk = clerkService({
      seed: {
        webhooks: [{ endpoint: `${hooks.url}/clerk` }],
        users: [{ email: "ada@danwo.test" }],
      },
    })
    const services = await startServices([clerk])

    try {
      const created = await clerk.emulator.fetch(
        new Request("https://api.clerk.com/v1/users", {
          method: "POST",
          headers: {
            authorization: `Bearer ${clerkInstance(clerk.emulator).instance.secretKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email_address: ["grace@danwo.test"] }),
        }),
      )

      expect(created.status).toBe(200)
      await services.settle()

      const types = hooks.received.map(
        (r) => z.object({ type: z.string() }).parse(JSON.parse(r.body)).type,
      )

      expect(types).toEqual(["user.created"])
      expect(hooks.received[0]?.headers["svix-signature"]).toMatch(/^v1,/)
      expect(services.mail).toHaveLength(1)
      expect(clerkInstance(clerk.emulator).user("ada@danwo.test")?.id).toBe(
        stableClerkId("user", "ada@danwo.test"),
      )
    } finally {
      await services.close()
      hooks.close()
    }
  })
})
