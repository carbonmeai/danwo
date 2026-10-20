import {
  clerkInstance,
  composioTools,
  type Emulator,
  PUSHER_DEFAULTS,
  pusherSignedQuery,
} from "@danwo/emulators"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { clerkService } from "../src/runner/clerk.ts"
import { composioService } from "../src/runner/composio.ts"
import { nangoService, nylasService, unipileService } from "../src/runner/connectors.ts"
import { StartingPoint } from "../src/runner/isolation.ts"
import { llmService } from "../src/runner/llm.ts"
import {
  auth0Service,
  bachsService,
  flutterwaveService,
  githubService,
  googleService,
  microsoftService,
  paystackService,
  slackService,
  twilioService,
} from "../src/runner/oauth.ts"
import { novuService, pusherService, tiptapService } from "../src/runner/realtime.ts"
import { resendService } from "../src/runner/resend.ts"
import { s3Service } from "../src/runner/s3.ts"
import type { Service } from "../src/runner/services.ts"
import { stripeService } from "../src/runner/stripe.ts"

/** An environment that counts what the starting point asks of it, with the slot it names. */
function countingEnv(
  options: {
    readonly keeps?: boolean
    readonly resets?: boolean
    readonly slots?: boolean
    readonly settles?: boolean
  } = {},
) {
  const calls: string[] = []

  const record =
    (name: string) =>
    async (slot?: string): Promise<void> => {
      calls.push(slot === undefined ? name : `${name} ${slot}`)
    }

  const env = {
    ...(options.resets !== false && { reset: record("reset") }),
    ...(options.keeps !== false && { snapshot: record("snapshot"), restore: record("restore") }),
    ...(options.slots === true && { snapshotSlots: true }),
    ...(options.settles === true && { settle: record("settle") }),
  }

  return { env, calls }
}

describe("StartingPoint", () => {
  it("resets and keeps a snapshot once, then restores it", async () => {
    const { env, calls } = countingEnv()
    let forgotten = 0
    const start = new StartingPoint(env, () => forgotten++)

    await start.clean()
    start.touch()
    await start.again()
    start.touch()
    await start.clean()

    expect(calls).toEqual(["reset", "snapshot", "restore", "restore"])
    expect(forgotten).toBe(1)
  })

  it("lets a reset's background work and a file's setup finish before keeping them", async () => {
    const { env, calls } = countingEnv({ settles: true })
    const start = new StartingPoint(env, () => {})

    await start.clean()
    start.touch()
    await start.keep("file")

    expect(calls).toEqual(["reset", "settle", "snapshot", "settle", "snapshot"])
  })

  it("restores nothing when the environment is still where it was put", async () => {
    const { env, calls } = countingEnv()
    const start = new StartingPoint(env, () => {})

    await start.clean()
    expect(start.untouched).toBe(true)
    await start.again()
    await start.clean()

    expect(calls).toEqual(["reset", "snapshot"])
  })

  it("restores a file's setup until the next file, which resets again", async () => {
    const { env, calls } = countingEnv()
    const start = new StartingPoint(env, () => {})

    await start.clean()
    start.touch()
    await start.keep("file")
    start.touch()
    await start.again()
    start.touch()
    await start.clean()

    expect(calls).toEqual(["reset", "snapshot", "snapshot", "restore", "reset", "snapshot"])
  })

  it("keeps each session's sign-in beside the seeded state, and a test without one starts from the seeded state", async () => {
    const { env, calls } = countingEnv({ slots: true })
    const start = new StartingPoint(env, () => {})

    await start.clean("ada")
    start.touch()
    start.signedIn("ada")
    await start.keep("session", "ada")
    expect(start.holds("ada")).toBe(true)
    // The attempt that signed in goes on after its sign-in is kept: the next test restores.
    expect(start.untouched).toBe(false)

    await start.again()
    expect(start.holds("ada")).toBe(false)

    start.touch()
    await start.again("ada")
    expect(start.holds("ada")).toBe(true)

    start.touch()
    await start.clean("bob")
    expect(start.holds("ada")).toBe(false)

    expect(calls).toEqual([
      "reset",
      "snapshot pristine",
      "snapshot pristine+ada",
      "restore pristine",
      "restore pristine+ada",
      "restore pristine",
    ])
  })

  it("keeps a session's sign-in on a file's setup only while that file runs", async () => {
    const { env, calls } = countingEnv({ slots: true })
    const start = new StartingPoint(env, () => {})

    await start.clean()
    start.touch()
    await start.keep("file")
    start.touch()
    start.signedIn("ada")
    await start.keep("session", "ada")
    start.touch()
    await start.again("ada")
    start.touch()
    await start.clean("ada")

    expect(calls).toEqual([
      "reset",
      "snapshot pristine",
      "snapshot file",
      "snapshot file+ada",
      "restore file+ada",
      "restore pristine",
    ])
    expect(start.holds("ada")).toBe(false)
  })

  it("keeps no sign-in when the environment keeps one state, so the session signs in again", async () => {
    const { env, calls } = countingEnv()
    const start = new StartingPoint(env, () => {})

    await start.clean()
    start.touch()
    start.signedIn("ada")
    await start.keep("session", "ada")
    expect(start.holds("ada")).toBe(true)

    start.touch()
    await start.again("ada")

    expect(calls).toEqual(["reset", "snapshot", "restore"])
    expect(start.holds("ada")).toBe(false)
  })

  it("resets every time without a snapshot, and does nothing without a reset", async () => {
    const plain = countingEnv({ keeps: false })
    let forgotten = 0
    const resetting = new StartingPoint(plain.env, () => forgotten++)

    await resetting.clean()
    resetting.touch()
    await resetting.again()
    await resetting.keep("file")
    expect(plain.calls).toEqual(["reset", "reset"])
    expect(forgotten).toBe(2)

    const fixed = countingEnv({ keeps: false, resets: false })
    const unmoved = new StartingPoint(fixed.env, () => forgotten++)

    unmoved.signedIn("ada")
    await unmoved.clean()
    unmoved.touch()
    await unmoved.again()
    expect(fixed.calls).toEqual([])
    expect(forgotten).toBe(2)
    expect(unmoved.holds("ada")).toBe(true)
  })
})

const Snapshot = z.object({
  collections: z.record(z.string(), z.object({ rows: z.array(z.unknown()) })),
  values: z.record(z.string(), z.unknown()),
})

/** The rows in each collection and the keys of each value: what any two seedings agree on. */
function shapeOf(state: unknown): Record<string, number | string[]> {
  const { collections, values } = Snapshot.parse(state)

  return {
    ...Object.fromEntries(Object.entries(collections).map(([name, c]) => [name, c.rows.length])),
    values: Object.keys(values).toSorted(),
  }
}

/** A JSON request to `url` on `emulator`. */
function post(
  emulator: Emulator,
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  return emulator.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  )
}

/** A form request to `url` on `emulator`. */
function postForm(
  emulator: Emulator,
  url: string,
  form: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return emulator.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(form).toString(),
    }),
  )
}

const GOOGLE_CLIENT = {
  client_id: "123-app.apps.googleusercontent.com",
  client_secret: "GOCSPX-app-secret",
  name: "Danwo App",
  redirect_uris: ["https://app.danwo.test/auth/google/callback"],
}

const MICROSOFT_CLIENT = {
  client_id: "6731de76-14a6-49ae-97bc-6eba6914391e",
  client_secret: "Qx~8Q~app-secret",
  name: "Danwo App",
  redirect_uris: ["https://app.danwo.test/callback"],
}

/** Opens an OAuth consent and picks the only account, leaving a grant the token endpoint redeems. */
async function consent(emulator: Emulator, authorize: URL): Promise<number> {
  const page = await (await emulator.fetch(new Request(authorize))).text()
  const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(page)?.[1] ?? ""
  const action = /<form method="post" action="([^"]+)"/.exec(page)?.[1] ?? ""
  const back = await emulator.fetch(
    new Request(new URL(action, authorize), {
      method: "POST",
      body: new URLSearchParams({ request: field("request"), user: field("user") }),
    }),
  )

  return back.status
}

/** The query string of an authorization request for `client`. */
function authorizeAt(base: string, client: typeof GOOGLE_CLIENT): URL {
  const url = new URL(base)

  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0] ?? "",
    response_type: "code",
    scope: "openid email",
  }).toString()

  return url
}

const TWILIO_ACCOUNT = "REDACTED-TEST-VALUE"
const TWILIO_TOKEN = "0000000000000000000000000000000a"
const PAYSTACK_KEY = "REDACTED-TEST-VALUE"
const SIGNED_S3 =
  "AWS4-HMAC-SHA256 Credential=k/20260101/auto/s3/aws4_request, SignedHeaders=host, Signature=0"

/** A service with an emulator, a way to change it through its API, and nothing else to know. */
interface Case {
  readonly name: string
  readonly make: () => Service & { readonly emulator: Emulator }
  readonly change: (emulator: Emulator) => Promise<unknown>
}

const CASES: readonly Case[] = [
  {
    name: "stripe",
    make: () => stripeService(),
    change: (e) =>
      postForm(
        e,
        "https://api.stripe.com/v1/customers",
        { email: "ada@shop.test" },
        { authorization: "Bearer sk_test_x" },
      ),
  },
  {
    name: "resend",
    make: () => resendService(),
    change: (e) =>
      post(
        e,
        "https://api.resend.com/emails",
        { from: "qa@danwo.test", to: "ada@shop.test", subject: "Hi", html: "<p>Hi</p>" },
        { authorization: "Bearer re_test" },
      ),
  },
  {
    name: "s3",
    make: () => s3Service({ seed: { buckets: [{ name: "uploads" }] } }),
    change: (e) =>
      e.fetch(
        new Request("https://uploads.t3.storage.dev/a.txt", {
          method: "PUT",
          body: "hi",
          headers: { authorization: SIGNED_S3 },
        }),
      ),
  },
  {
    name: "google",
    make: () =>
      googleService({
        seed: { users: [{ email: "ada@danwo.test", name: "Ada" }], oauth_clients: [GOOGLE_CLIENT] },
      }),
    change: (e) =>
      consent(e, authorizeAt("https://accounts.google.com/o/oauth2/v2/auth", GOOGLE_CLIENT)),
  },
  {
    name: "microsoft",
    make: () =>
      microsoftService({
        seed: {
          users: [{ email: "ada@contoso.test", name: "Ada" }],
          oauth_clients: [MICROSOFT_CLIENT],
        },
      }),
    change: (e) =>
      consent(
        e,
        authorizeAt(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
          MICROSOFT_CLIENT,
        ),
      ),
  },
  {
    name: "slack",
    make: () =>
      slackService({
        seed: {
          users: [{ name: "ada" }],
          apps: [
            {
              name: "Echo",
              client_id: "1.2",
              client_secret: "s",
              signing_secret: "echo-signing",
              bot_scopes: ["chat:write"],
            },
          ],
          installations: [{ app: "Echo", bot_token: "xoxb-echo", channels: ["general"] }],
        },
      }),
    change: (e) =>
      postForm(
        e,
        "https://slack.com/api/chat.postMessage",
        { channel: "general", text: "hi" },
        { authorization: "Bearer xoxb-echo" },
      ),
  },
  {
    name: "github",
    make: () =>
      githubService({
        seed: {
          users: [{ login: "ada" }],
          repos: [{ repo: "ada/widgets" }],
          tokens: [{ token: "REDACTED-TEST-VALUE", login: "ada" }],
        },
      }),
    change: (e) =>
      post(
        e,
        "https://api.github.com/repos/ada/widgets/issues",
        { title: "It broke" },
        { authorization: "token REDACTED-TEST-VALUE" },
      ),
  },
  {
    name: "twilio",
    make: () =>
      twilioService({
        seed: {
          accounts: [{ sid: TWILIO_ACCOUNT, authToken: TWILIO_TOKEN }],
          numbers: [{ number: "+15005550006" }],
        },
      }),
    change: (e) =>
      postForm(
        e,
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT}/Messages.json`,
        { From: "+15005550006", To: "+14155550123", Body: "Your code is 123456" },
        {
          authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT}:${TWILIO_TOKEN}`).toString("base64")}`,
        },
      ),
  },
  {
    name: "paystack",
    make: () => paystackService({ seed: { integrations: [{ secretKey: PAYSTACK_KEY }] } }),
    change: (e) =>
      post(
        e,
        "https://api.paystack.co/transaction/initialize",
        { email: "ada@shop.test", amount: 500_000 },
        { authorization: `Bearer ${PAYSTACK_KEY}` },
      ),
  },
  {
    name: "flutterwave",
    make: () => flutterwaveService(),
    change: (e) =>
      post(
        e,
        "https://api.flutterwave.com/v3/payments",
        {
          tx_ref: "order-1",
          amount: "5000",
          currency: "NGN",
          redirect_url: "https://shop.test/done",
          customer: { email: "ada@shop.test" },
        },
        { authorization: "Bearer REDACTED-TEST-VALUE" },
      ),
  },
  {
    name: "bachs",
    make: () => bachsService(),
    change: (e) =>
      post(
        e,
        "https://sandbox-api.bachs.io/v1/customers",
        // Bachs refuses reserved domains such as `.test`, as the real API refuses ones with no mail.
        { email: "ada@gmail.com", name: "Ada" },
        { authorization: "Bearer sk_sandbox_danwo" },
      ),
  },
  {
    name: "auth0",
    make: () =>
      auth0Service({
        seed: {
          tenants: [
            {
              domain: "acme.us.auth0.com",
              clients: [
                {
                  client_id: "web",
                  client_secret: "web-secret",
                  name: "Web",
                  callbacks: ["https://app.danwo.test/callback"],
                },
              ],
            },
          ],
        },
      }),
    change: (e) =>
      e.fetch(
        new Request(
          "https://acme.us.auth0.com/authorize?client_id=web&redirect_uri=https%3A%2F%2Fapp.danwo.test%2Fcallback&response_type=code&scope=openid",
          { redirect: "manual" },
        ),
      ),
  },
  {
    name: "clerk",
    make: () => clerkService(),
    change: (e) =>
      post(
        e,
        "https://api.clerk.com/v1/users",
        { email_address: ["ada@shop.test"], password: "correct horse battery staple" },
        { authorization: "Bearer REDACTED-TEST-VALUE" },
      ),
  },
  {
    name: "clerk with webhooks and seeded ids",
    make: () =>
      clerkService({
        seed: {
          users: [{ email: "ada@shop.test" }],
          organizations: [{ name: "Acme", members: [{ email: "ada@shop.test" }] }],
          webhooks: [{ endpoint: "http://127.0.0.1:9/webhooks/clerk" }],
        },
      }),
    change: (e) =>
      post(
        e,
        "https://api.clerk.com/v1/users",
        { email_address: ["grace@shop.test"] },
        { authorization: "Bearer REDACTED-TEST-VALUE" },
      ),
  },
  {
    name: "stripe subscriptions",
    make: () =>
      stripeService({
        seed: () => ({
          customers: [{ id: "cus_ada", email: "ada@shop.test" }],
          products: [{ name: "Pro" }],
          prices: [
            {
              id: "price_pro",
              product_name: "Pro",
              currency: "usd",
              unit_amount: 2000,
              recurring: { interval: "month" },
            },
          ],
        }),
      }),
    change: (e) =>
      postForm(
        e,
        "https://api.stripe.com/v1/subscriptions",
        { customer: "cus_ada", "items[0][price]": "price_pro", trial_period_days: "7" },
        { authorization: "Bearer sk_test_emulated" },
      ),
  },
  {
    name: "composio",
    make: () => composioService(),
    change: (e) =>
      post(
        e,
        "https://backend.composio.dev/api/v3/auth_configs",
        { toolkit: { slug: "gmail" } },
        { "x-api-key": "ak_danwo_test" },
      ),
  },
  {
    name: "nylas",
    make: () =>
      nylasService({
        seed: { grants: [{ id: "11111111-1111-4111-8111-111111111111", email: "ada@acme.test" }] },
      }),
    change: (e) =>
      post(
        e,
        "https://api.us.nylas.com/v3/grants/11111111-1111-4111-8111-111111111111/messages/send",
        { to: [{ email: "grace@acme.test" }], subject: "Hi", body: "Hello" },
        { authorization: "Bearer REDACTED-TEST-VALUE" },
      ),
  },
  {
    name: "nango",
    make: () => nangoService({ seed: { integrations: [{ key: "hubspot" }] } }),
    change: (e) =>
      post(
        e,
        "https://api.nango.dev/connect/sessions",
        { end_user: { id: "u1" } },
        { authorization: "Bearer nango-secret" },
      ),
  },
  {
    name: "unipile",
    make: () =>
      unipileService({
        seed: { accounts: [{ id: "acc", type: "LINKEDIN", name: "Ada", username: "ada" }] },
      }),
    change: (e) =>
      post(
        e,
        "https://api8.unipile.com/api/v1/chats",
        { account_id: "acc", attendees_ids: ["ACoAAgrace"], text: "Hi" },
        { "x-api-key": "unipile-token" },
      ),
  },
  {
    name: "pusher",
    make: () => pusherService(),
    change: (e) => {
      const app = { ...PUSHER_DEFAULTS.app, webhooks: [] }
      const path = `/apps/${app.id}/events`
      const body = JSON.stringify({ name: "placed", channels: ["orders"], data: "{}" })
      const query = pusherSignedQuery(app, "POST", path, body, new Date())

      return e.fetch(
        new Request(`https://api-mt1.pusher.com${path}?${query.toString()}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      )
    },
  },
  {
    name: "novu",
    make: () => novuService(),
    change: (e) =>
      post(
        e,
        "https://api.novu.co/v2/subscribers",
        { subscriberId: "ada", email: "ada@shop.test" },
        { authorization: "ApiKey danwo-novu-secret-key" },
      ),
  },
  {
    name: "tiptap",
    make: () => tiptapService(),
    change: (e) =>
      post(
        e,
        "https://app.collab.tiptap.cloud/api/documents/note?format=json",
        { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
        {},
      ),
  },
  {
    name: "llm",
    make: () => llmService(),
    change: (e) =>
      post(
        e,
        "https://api.openai.com/v1/chat/completions",
        { model: "gpt-5", messages: [{ role: "user", content: "hi" }] },
        { authorization: "Bearer sk-test-danwo" },
      ),
  },
]

describe("every emulator's reset and restore", () => {
  it.each(CASES)(
    "$name: a restore gives back the snapshot, a reset the seeded shape",
    async (c) => {
      const service = c.make()

      try {
        const seeded = service.state?.()

        await service.snapshot?.()

        const answer = await c.change(service.emulator)

        expect(answer instanceof Response ? answer.status : 200).toBeLessThan(400)
        // The change went through the API, so the store is no longer what was kept.
        expect(service.state?.()).not.toEqual(seeded)

        await service.restore?.()
        expect(service.state?.()).toEqual(seeded)

        await c.change(service.emulator)
        await service.reset?.()
        expect(shapeOf(service.state?.())).toEqual(shapeOf(seeded))
      } finally {
        await service.close()
      }
    },
  )

  it("drops Clerk's queued webhooks on restore and keeps its seeded ids across resets", async () => {
    const service = clerkService({
      seed: {
        users: [{ email: "ada@shop.test" }],
        webhooks: [{ endpoint: "http://127.0.0.1:9/webhooks/clerk" }],
      },
    })
    const ada = () => clerkInstance(service.emulator).user("ada@shop.test")?.id

    try {
      const seededId = ada()

      await service.snapshot?.()
      await post(
        service.emulator,
        "https://api.clerk.com/v1/users",
        { email_address: ["grace@shop.test"] },
        { authorization: "Bearer REDACTED-TEST-VALUE" },
      )
      expect(service.emulator.outbox.all().map((m) => m.topic)).toEqual(["user.created"])

      await service.restore?.()
      expect(service.emulator.outbox.all()).toEqual([])

      await service.reset?.()
      expect(ada()).toBe(seededId)
      expect(clerkInstance(service.emulator).webhookSecret()).toMatch(/^whsec_/)
    } finally {
      await service.close()
    }
  })

  it("renews nothing after a restore drops a Stripe subscription", async () => {
    const service = stripeService({
      seed: () => ({
        customers: [{ id: "cus_ada", email: "ada@shop.test" }],
        products: [{ name: "Pro" }],
        prices: [
          {
            id: "price_pro",
            product_name: "Pro",
            currency: "usd",
            unit_amount: 2000,
            recurring: { interval: "month" },
          },
        ],
      }),
    })

    try {
      await service.snapshot?.()
      await postForm(
        service.emulator,
        "https://api.stripe.com/v1/subscriptions",
        { customer: "cus_ada", "items[0][price]": "price_pro", trial_period_days: "1" },
        { authorization: "Bearer sk_test_emulated" },
      )
      await service.restore?.()
      // The subscription's renewal timer still fires, but finds nothing due in the restored store.
      await service.travel?.(40 * 86_400_000)
      expect(service.emulator.outbox.all()).toEqual([])
    } finally {
      await service.close()
    }
  })

  it("drops tool handlers test code set when Composio is restored", async () => {
    const service = composioService({
      seed: { connectedAccounts: [{ userId: "ada", toolkit: "gmail" }] },
    })

    const sent = async () => {
      const executed = await post(
        service.emulator,
        "https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL",
        { user_id: "ada", arguments: { recipient_email: "a@b.test", body: "hi" } },
        { "x-api-key": "ak_danwo_test" },
      )
      const body = z
        .object({ data: z.object({ id: z.string().optional() }).nullish() })
        .parse(await executed.json())

      return body.data?.id
    }

    try {
      await service.snapshot?.()
      composioTools(service.emulator).handle("GMAIL_SEND_EMAIL", () => ({ id: "m1" }))
      expect(await sent()).toBe("m1")

      await service.restore?.()
      expect(await sent()).not.toBe("m1")
    } finally {
      await service.close()
    }
  })
})
