import { createPublicKey, createVerify, type KeyObject } from "node:crypto"

import { google as googleapis } from "googleapis"
import { afterEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import { gmailMailbox } from "../src/google/index.ts"
import { AUTH, authFor, consent, fetchVia, googleWith } from "./google-api.ts"

const ENDPOINT = "https://app.danwo.test/push/gmail"
const PUSHER = "gmail-push@app.iam.gserviceaccount.com"

let emulator: Emulator

afterEach(async () => {
  await emulator.close()
})

/** One push as the app received it. */
interface Received {
  readonly headers: Record<string, string>
  readonly body: string
}

/** A Google emulator whose pushes land in `received`, answering 204. */
function pushingTo(received: Received[], audience?: string): Emulator {
  return googleWith(
    {
      pubsub: [
        {
          subscription: "projects/app/subscriptions/gmail-push",
          topic: "projects/app/topics/gmail",
          endpoint: ENDPOINT,
          oidcToken: { serviceAccountEmail: PUSHER, ...(audience && { audience }) },
        },
      ],
    },
    {
      fetch: async (_url, init) => {
        received.push({
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: typeof init?.body === "string" ? init.body : "",
        })

        return new Response(null, { status: 204 })
      },
    },
  )
}

/** Watches Ada's inbox, delivers one message to it and waits for its pushes. */
async function pushOnce(): Promise<void> {
  const tokens = await consent(emulator, "ada@danwo.test", [`${AUTH}gmail.modify`])
  const gmail = googleapis.gmail({
    version: "v1",
    auth: authFor(emulator, tokens),
    fetchImplementation: fetchVia(emulator),
  })

  await gmail.users.watch({
    userId: "me",
    requestBody: { topicName: "projects/app/topics/gmail", labelIds: ["INBOX"] },
  })
  gmailMailbox(emulator, "ada@danwo.test").deliver({ from: "x@vendor.test", subject: "Ping" })
  await new Promise((resolve) => setTimeout(resolve, 20))
  await emulator.webhooks?.idle()
}

/** The first key Google's certificate URL lists, as a public key. */
async function googleKey(): Promise<KeyObject> {
  const certs = await emulator.fetch(new Request("https://www.googleapis.com/oauth2/v3/certs"))
  const body: unknown = await certs.json()
  const keys = typeof body === "object" && body !== null && "keys" in body ? body.keys : []
  const first: unknown = Array.isArray(keys) ? keys[0] : undefined

  if (typeof first !== "object" || first === null) throw new Error("no certificate")

  return createPublicKey({ key: { ...first }, format: "jwk" })
}

/** The JSON object a token part decodes to. */
function decoded(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString())

  return typeof value === "object" && value !== null ? { ...value } : {}
}

/** The claims of a push's bearer token, or `invalid` when Google's certificates don't verify it. */
async function claimsOf(push: Received | undefined): Promise<Record<string, unknown> | "invalid"> {
  const token = (push?.headers["authorization"] ?? "").replace(/^Bearer /, "")
  const [header = "", payload = "", signature = ""] = token.split(".")
  const valid = createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(await googleKey(), Buffer.from(signature, "base64url"))

  return valid ? decoded(payload) : "invalid"
}

describe("signed Pub/Sub pushes", () => {
  it("carries an OIDC token Google's certificates verify, for the push endpoint", async () => {
    const received: Received[] = []

    emulator = pushingTo(received)
    await pushOnce()

    expect(received).toHaveLength(1)
    const claims = await claimsOf(received[0])

    expect(claims).toMatchObject({
      iss: "https://accounts.google.com",
      aud: ENDPOINT,
      email: PUSHER,
      email_verified: true,
    })
    expect(claims !== "invalid" && Number(claims.exp) - Number(claims.iat)).toBe(3600)
    expect(claims !== "invalid" && Number(claims.exp) * 1000).toBeGreaterThan(Date.now())
  })

  it("uses the subscription's own audience when it names one", async () => {
    const received: Received[] = []

    emulator = pushingTo(received, "https://app.danwo.test")
    await pushOnce()

    expect(await claimsOf(received[0])).toMatchObject({ aud: "https://app.danwo.test" })
  })

  it("sends a forged copy whose token no certificate verifies, then the real push", async () => {
    const received: Received[] = []

    emulator = pushingTo(received)
    emulator.webhooks?.setFault(() => ({ kind: "forged" }))
    await pushOnce()

    const verdicts = await Promise.all(received.map(async (push) => claimsOf(push)))

    expect(verdicts.filter((claims) => claims === "invalid")).toHaveLength(1)
    expect(verdicts.filter((claims) => claims !== "invalid")).toHaveLength(1)
  })

  it("sends a stale push whose token has already expired", async () => {
    const received: Received[] = []

    emulator = pushingTo(received)
    emulator.webhooks?.setFault(() => ({ kind: "stale", seconds: 3600 }))
    await pushOnce()

    const claims = await claimsOf(received[0])

    expect(claims).not.toBe("invalid")
    expect(claims !== "invalid" && Number(claims.exp) * 1000).toBeLessThan(Date.now() - 60_000)
  })

  it("leaves pushes unsigned for a subscription without authentication", async () => {
    const received: Received[] = []

    emulator = googleWith(
      {
        pubsub: [
          {
            subscription: "projects/app/subscriptions/gmail-push",
            topic: "projects/app/topics/gmail",
            endpoint: ENDPOINT,
          },
        ],
      },
      {
        fetch: async (_url, init) => {
          received.push({ headers: Object.fromEntries(new Headers(init?.headers)), body: "" })

          return new Response(null, { status: 204 })
        },
      },
    )
    await pushOnce()

    expect(received[0]?.headers["authorization"]).toBeUndefined()
  })
})

describe("watch channel notifications", () => {
  it("arrive with an empty body; the headers carry what changed", async () => {
    const received: Received[] = []

    emulator = pushingTo(received)
    const tokens = await consent(emulator, "ada@danwo.test", [`${AUTH}calendar`])
    const calendar = googleapis.calendar({
      version: "v3",
      auth: authFor(emulator, tokens),
      fetchImplementation: fetchVia(emulator),
    })

    await calendar.events.watch({
      calendarId: "primary",
      requestBody: { id: "chan-1", type: "web_hook", address: "https://app.danwo.test/push/cal" },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await emulator.webhooks?.idle()

    expect(received).toHaveLength(1)
    expect(received[0]?.body).toBe("")
    expect(received[0]?.headers["content-type"]).toBeUndefined()
    expect(received[0]?.headers["x-goog-resource-state"]).toBe("sync")
  })
})
