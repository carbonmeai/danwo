/**
 * Clerk's webhooks against the live shapes: Clerk sends the same object in a webhook's `data` as
 * the Backend API answers, so the emulator's `user.*`, `organization.*` and
 * `organizationMembership.*` payloads are compared with the shapes the live suite recorded in
 * `fidelity/clerk.json`, and each delivery must pass `@clerk/backend`'s `verifyWebhook`.
 */
import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { join } from "node:path"

import { verifyWebhook } from "@clerk/backend/webhooks"
import { clerk, clerkInstance, createEmulator, type Emulator, seedClerk } from "@danwo/emulators"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { compareShapes } from "../src/compare.ts"
import { readGolden } from "../src/golden.ts"
import { asJsonObject, type Json, shapeOf } from "../src/shape.ts"

const root = join(import.meta.dirname, "..", "..", "..")
const SECRET = `whsec_${Buffer.from("clerk-fidelity-webhook-secret-32").toString("base64")}`
const LITERALS = ["status", "role", "deleted"]
const MAPS = ["**.public_metadata", "**.private_metadata", "**.unsafe_metadata"]

/** Collects the deliveries `verifyWebhook` accepts, and counts the ones it refuses. */
class Receiver {
  readonly events: { type: string; data: Json }[] = []
  refused = 0
  url = ""
  private readonly server: Server = createServer((req, res) => void this.handle(req, res))

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1")
    await once(this.server, "listening")

    const address = this.server.address()

    this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/clerk`
  }

  close(): void {
    this.server.close()
  }

  /** The `data` of the first event of `type` that `matches`, waiting for it to arrive. */
  async data(type: string, matches: (data: Json) => boolean = () => true): Promise<Json> {
    for (let tries = 0; tries < 100; tries++) {
      const event = this.events.find(
        (candidate) => candidate.type === type && matches(candidate.data),
      )

      if (event) return event.data

      await new Promise((done) => setTimeout(done, 20))
    }

    throw new Error(`no ${type} webhook arrived`)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []

    for await (const chunk of req) chunks.push(Buffer.from(chunk))

    const headers = new Headers()

    for (const [name, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(name, value)

    try {
      const body = Buffer.concat(chunks)
      const event = await verifyWebhook(new Request(this.url, { method: "POST", headers, body }), {
        signingSecret: SECRET,
      })
      const parsed: unknown = JSON.parse(body.toString("utf8"))
      const data = asJsonObject(parsed as Json)?.["data"] ?? null

      this.events.push({ type: event.type, data })
      res.statusCode = 200
    } catch {
      this.refused++
      res.statusCode = 400
    }

    res.end()
  }
}

let receiver: Receiver
let emulator: Emulator

beforeEach(async () => {
  receiver = new Receiver()
  await receiver.start()
  emulator = createEmulator(clerk)
  seedClerk(emulator.store, { webhooks: [{ endpoint: receiver.url, secret: SECRET }] })
})

afterEach(async () => {
  receiver.close()
  await emulator.close()
})

/** A Backend API call to the emulator; resolves to the answer's JSON. */
async function backend(method: string, path: string, body?: unknown): Promise<Json> {
  const answer = await emulator.fetch(
    new Request(`https://api.clerk.com/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${clerkInstance(emulator).instance.secretKey}`,
        "content-type": "application/json",
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  )
  const parsed: Json = await answer.json()

  return parsed
}

/** The id field of an answer. */
function idOf(answer: Json): string {
  const id = asJsonObject(answer)?.["id"]

  if (typeof id !== "string") throw new Error("the answer has no id")

  return id
}

/** The live shape the golden recorded for `step` of `scenario`. */
async function liveShape(scenario: string, step: string) {
  const golden = await readGolden(root, "clerk")
  const recorded = golden?.scenarios[scenario]?.steps.find((s) => s.step === step)

  if (!recorded) throw new Error(`the Clerk golden has no "${step}" in "${scenario}"`)

  return recorded.shape
}

const USERS = "users: create, read, list, update, ban, delete"
const ORGANIZATIONS = "organizations: create, members, invitations, delete"

describe("Clerk webhooks against the live Backend API shapes", () => {
  it("sends user and organization data shaped like the API's own objects, signed for verifyWebhook", async () => {
    const user = idOf(
      await backend("POST", "/users", {
        email_address: ["webhook+clerk_test@example.com"],
        password: "Fidelity-webhook-Pw!9",
        first_name: "Fidelity",
        last_name: "Check",
        external_id: "fidelity_webhook",
        public_metadata: { plan: "pro" },
        private_metadata: { tier: 1 },
        unsafe_metadata: { theme: "dark" },
      }),
    )
    const member = idOf(
      await backend("POST", "/users", {
        email_address: ["member+clerk_test@example.com"],
        first_name: "Fidelity",
        last_name: "Member",
      }),
    )
    const org = idOf(
      await backend("POST", "/organizations", { name: "Fidelity Webhooks", created_by: user }),
    )

    await backend("POST", `/organizations/${org}/memberships`, {
      user_id: member,
      role: "org:member",
    })

    await backend("DELETE", `/organizations/${org}`)
    await backend("DELETE", `/users/${user}`)
    await backend("DELETE", `/users/${member}`)

    /** The membership the scenario added: a plain member, as the golden recorded it. */
    const plainMember = (data: Json) => asJsonObject(data)?.["role"] === "org:member"
    const cases: [string, string, string, ((data: Json) => boolean)?][] = [
      ["user.created", USERS, "create user (user)"],
      ["user.deleted", USERS, "delete user"],
      ["organization.created", ORGANIZATIONS, "create organization"],
      ["organizationMembership.created", ORGANIZATIONS, "add member", plainMember],
      ["organization.deleted", ORGANIZATIONS, "delete organization"],
    ]

    for (const [type, scenario, step, matches] of cases) {
      const shape = shapeOf(await receiver.data(type, matches), { literals: LITERALS, maps: MAPS })
      const differences = compareShapes(await liveShape(scenario, step), shape)

      expect({ type, differences }).toEqual({ type, differences: [] })
    }

    expect(receiver.refused).toBe(0)
  })
})
