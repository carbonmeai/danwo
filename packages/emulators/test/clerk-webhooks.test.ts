import { generateKeyPairSync } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { verifyToken } from "@clerk/backend"
import { verifyWebhook } from "@clerk/backend/webhooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clerkInstance, seedClerk, stableClerkId } from "../src/clerk/index.ts"
import { clerkTestbed } from "./clerk-client.ts"

const SECRET = `whsec_${Buffer.from("clerk-webhook-test-secret-32b!!!").toString("base64")}`

/** An app's Clerk webhook route: verifies each delivery with `@clerk/backend`'s `verifyWebhook`. */
class Receiver {
  readonly received: { type: string; data: Record<string, unknown>; headers: Headers }[] = []
  readonly rejected: number[] = []
  readonly server: Server = createServer((req, res) => void this.handle(req, res))
  url = ""

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1")
    await once(this.server, "listening")

    const address = this.server.address()
    const port = typeof address === "object" && address !== null ? address.port : 0

    this.url = `http://127.0.0.1:${port}/webhooks/clerk`
  }

  types(): string[] {
    return this.received.map((event) => event.type)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []

    for await (const chunk of req) chunks.push(Buffer.from(chunk))

    const headers = new Headers()

    for (const [name, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(name, value)

    try {
      const event = await verifyWebhook(
        new Request(this.url, { method: "POST", headers, body: Buffer.concat(chunks) }),
        { signingSecret: SECRET },
      )

      this.received.push({ type: event.type, data: { ...event.data }, headers })
      res.statusCode = 200
    } catch {
      this.rejected.push(Date.now())
      res.statusCode = 400
    }

    res.end()
  }
}

let bed: ReturnType<typeof clerkTestbed>
let receiver: Receiver

beforeEach(async () => {
  receiver = new Receiver()
  await receiver.start()
})

afterEach(async () => {
  bed.close()
  await bed.emulator.close()
  receiver.server.close()
})

describe("Clerk webhooks", () => {
  it("sends user, session and organization events the official verifier accepts", async () => {
    bed = clerkTestbed({ webhooks: [{ endpoint: receiver.url, secret: SECRET }] })

    const user = await bed.client.users.createUser({
      emailAddress: ["ada@danwo.test"],
      password: "s3cret-pass",
    })

    await bed.client.users.updateUser(user.id, { firstName: "Ada" })

    const session = await bed.client.sessions.createSession({ userId: user.id })

    await bed.client.sessions.revokeSession(session.id)

    const org = await bed.client.organizations.createOrganization({
      name: "Acme",
      createdBy: user.id,
    })

    await bed.client.organizations.deleteOrganization(org.id)
    await bed.client.users.deleteUser(user.id)

    await vi.waitFor(() => expect(receiver.received).toHaveLength(8))
    expect(receiver.types()).toEqual([
      "user.created",
      "user.updated",
      "session.created",
      "session.revoked",
      "organization.created",
      "organizationMembership.created",
      "organization.deleted",
      "user.deleted",
    ])
    expect(receiver.received[0]?.data).toMatchObject({ id: user.id, object: "user" })
    expect(receiver.received[2]?.data).toMatchObject({
      id: session.id,
      user_id: user.id,
      user: { id: user.id },
    })
    expect(receiver.received.at(-1)?.data).toEqual({ object: "user", id: user.id, deleted: true })
  })

  it("sends an endpoint's custom headers with every delivery, without replacing Svix's", async () => {
    bed = clerkTestbed({
      webhooks: [
        {
          endpoint: receiver.url,
          secret: SECRET,
          headers: { "x-app-token": "shared-token", "svix-id": "not-used" },
        },
      ],
    })

    await bed.client.users.createUser({ emailAddress: ["ada@danwo.test"] })

    await vi.waitFor(() => expect(receiver.received).toHaveLength(1))
    expect(receiver.received[0]?.headers.get("x-app-token")).toBe("shared-token")
    expect(receiver.received[0]?.headers.get("svix-id")).toMatch(/^msg_/)
  })

  it("only sends an endpoint the events it subscribes to", async () => {
    bed = clerkTestbed({
      webhooks: [{ endpoint: receiver.url, secret: SECRET, events: ["user.created"] }],
    })

    const user = await bed.client.users.createUser({ emailAddress: ["ada@danwo.test"] })

    await bed.client.users.updateUser(user.id, { firstName: "Ada" })
    await bed.client.users.createUser({ emailAddress: ["grace@danwo.test"] })

    await vi.waitFor(() => expect(receiver.received).toHaveLength(2))
    expect(receiver.types()).toEqual(["user.created", "user.created"])
  })

  it("announces seeded users and organizations only when asked to", async () => {
    bed = clerkTestbed({
      webhooks: [{ endpoint: receiver.url, secret: SECRET }],
      users: [{ email: "ada@danwo.test" }],
      organizations: [{ name: "Acme", members: [{ email: "ada@danwo.test", role: "org:admin" }] }],
    })
    await bed.client.users.createUser({ emailAddress: ["grace@danwo.test"] })
    await vi.waitFor(() => expect(receiver.received).toHaveLength(1))

    bed.emulator.reset()
    seedClerk(bed.emulator.store, {
      webhooks: [{ endpoint: receiver.url, secret: SECRET }],
      users: [{ email: "ada@danwo.test" }],
      organizations: [{ name: "Acme", members: [{ email: "ada@danwo.test", role: "org:admin" }] }],
      announce: true,
    })

    await vi.waitFor(() => expect(receiver.received).toHaveLength(4))
    expect(receiver.types().slice(1).toSorted()).toEqual([
      "organization.created",
      "organizationMembership.created",
      "user.created",
    ])
  })

  it("signs with a secret derived from the endpoint when the seed gives none", async () => {
    bed = clerkTestbed({ webhooks: [{ endpoint: receiver.url }] })

    const secret = clerkInstance(bed.emulator).webhookSecret()

    bed.emulator.reset()
    seedClerk(bed.emulator.store, { webhooks: [{ endpoint: receiver.url }] })

    expect(clerkInstance(bed.emulator).webhookSecret()).toBe(secret)
    expect(clerkInstance(bed.emulator).env().CLERK_WEBHOOK_SIGNING_SECRET).toBe(secret)
  })
})

describe("stable ids", () => {
  it("gives seeded users and organizations the same ids after a reset", async () => {
    const config = {
      users: [{ email: "Ada@danwo.test" }, { email: "grace@danwo.test", id: "user_grace" }],
      organizations: [{ name: "Acme", members: [{ email: "Ada@danwo.test" }] }],
    }

    bed = clerkTestbed(config)

    const view = clerkInstance(bed.emulator)
    const ada = view.user("ada@danwo.test")
    const org = view.organizations()[0]

    expect(ada?.id).toBe(stableClerkId("user", "ada@danwo.test"))
    expect(view.user("grace@danwo.test")?.id).toBe("user_grace")

    bed.emulator.reset()
    seedClerk(bed.emulator.store, config)

    expect(clerkInstance(bed.emulator).user("ada@danwo.test")).toMatchObject({
      id: ada?.id,
      primary_email_address_id: ada?.primary_email_address_id,
    })
    expect(clerkInstance(bed.emulator).organizations()[0]?.id).toBe(org?.id)
  })
})

describe("offline verification", () => {
  it("verifies session tokens with the PEM, for the seeded origin", async () => {
    bed = clerkTestbed({
      users: [{ email: "ada@danwo.test" }],
      instance: { origin: "http://localhost:3050" },
    })

    const ada = clerkInstance(bed.emulator).user("ada@danwo.test")
    const session = await bed.client.sessions.createSession({ userId: ada?.id ?? "" })
    const token = await bed.client.sessions.getToken(session.id, "")
    const claims = await verifyToken(token.jwt, {
      jwtKey: clerkInstance(bed.emulator).publicKeyPem(),
      authorizedParties: ["http://localhost:3050"],
    })

    expect(claims).toMatchObject({ sub: ada?.id, sid: session.id, azp: "http://localhost:3050" })
  })

  it("signs with a seeded key, so its PEM stays valid across emulators", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const signingKey = privateKey.export({ format: "pem", type: "pkcs8" }).toString()

    bed = clerkTestbed({ users: [{ email: "ada@danwo.test" }], instance: { signingKey } })

    const pem = publicKey.export({ format: "pem", type: "spki" }).toString()
    const ada = clerkInstance(bed.emulator).user("ada@danwo.test")
    const session = await bed.client.sessions.createSession({ userId: ada?.id ?? "" })
    const token = await bed.client.sessions.getToken(session.id, "")

    expect(clerkInstance(bed.emulator).publicKeyPem()).toBe(pem)
    await expect(verifyToken(token.jwt, { jwtKey: pem })).resolves.toMatchObject({ sub: ada?.id })
  })
})
