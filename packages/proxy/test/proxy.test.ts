import { execFile } from "node:child_process"
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import {
  createEmulator,
  GOOGLE_HOSTS,
  google,
  googleOutboundFaults,
  MICROSOFT_HOSTS,
  microsoft,
  outlookMailbox,
  resend,
  resendInbox,
  s3,
  s3Hosts,
  s3Objects,
  seedGoogle,
  seedMicrosoft,
  seedS3,
  stripe,
} from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { MAX_CAPTURED_BODY_BYTES } from "../src/capture.ts"
import { startProxy } from "../src/proxy.ts"

const run = promisify(execFile)
const APP = fileURLToPath(new URL("./fixtures/app.mjs", import.meta.url))
const RESEND_APP = fileURLToPath(new URL("./fixtures/resend-app.mjs", import.meta.url))
const S3_APP = fileURLToPath(new URL("./fixtures/s3-app.mjs", import.meta.url))
const OAUTH_APP = fileURLToPath(new URL("./fixtures/oauth-app.mjs", import.meta.url))
const FETCH_APP = fileURLToPath(new URL("./fixtures/fetch-app.mjs", import.meta.url))
const GOOGLE_SYNC_APP = fileURLToPath(new URL("./fixtures/google-sync-app.mjs", import.meta.url))
const GRAPH_SYNC_APP = fileURLToPath(new URL("./fixtures/graph-sync-app.mjs", import.meta.url))

let other: Server
let otherUrl: string

beforeAll(async () => {
  other = createServer((_req, res) => {
    res.statusCode = 204
    res.end()
  })
  other.listen(0, "127.0.0.1")
  await once(other, "listening")
  otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/ping`
})

afterAll(() => {
  other.close()
})

interface AppOutput {
  customer?: string
  checkoutUrl?: string
  checkoutPage?: number
  stripeError?: string
  other?: number
  otherError?: string
}

async function runApp(env: NodeJS.ProcessEnv): Promise<AppOutput> {
  const { stdout } = await run(process.execPath, [APP], {
    env: { ...env, OTHER_SERVICE_URL: otherUrl },
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    timeout: 30_000,
  })

  return JSON.parse(stdout) as AppOutput
}

describe("routing an unmodified app", () => {
  it("sends the official Stripe client to the emulator and passes other hosts through", async () => {
    const emulator = createEmulator(stripe, { baseUrl: "https://checkout.stripe.com" })
    const proxy = await startProxy({
      routes: [{ hosts: ["api.stripe.com", "checkout.stripe.com"], handler: emulator.fetch }],
    })

    try {
      const out = await runApp(proxy.env())

      expect(out.stripeError).toBeUndefined()
      expect(out.customer).toMatch(/^cus_/)
      expect(emulator.store.collection("stripe.customers").count()).toBe(2) // seeded + the app's
      expect(out.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\/checkout\/cs_/)
      expect(out.checkoutPage).toBe(200)
      expect(out.other).toBe(204)

      await proxy.settled()

      const exchanges = proxy.exchanges()

      expect(
        exchanges
          .filter((e) => e.disposition === "routed")
          .map((e) => `${e.method} ${e.host}${e.path}`),
      ).toEqual([
        "POST api.stripe.com/v1/customers",
        "POST api.stripe.com/v1/products",
        "POST api.stripe.com/v1/checkout/sessions",
        expect.stringMatching(/^GET checkout\.stripe\.com\/checkout\/cs_/),
      ])
      expect(exchanges.find((e) => e.disposition === "passthrough")).toMatchObject({
        host: "127.0.0.1",
        path: "/ping",
        status: 204,
      })
      expect(exchanges.every((e) => e.status !== null)).toBe(true)
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  })

  it("blocks unrouted hosts when asked", async () => {
    const emulator = createEmulator(stripe)
    const proxy = await startProxy({
      routes: [{ hosts: ["api.stripe.com", "checkout.stripe.com"], handler: emulator.fetch }],
      unmatched: "block",
    })

    try {
      const out = await runApp(proxy.env())

      expect(out.customer).toMatch(/^cus_/)
      expect(out.other).toBe(502)
      await proxy.settled()
      expect(proxy.exchanges().find((e) => e.path === "/ping")).toMatchObject({
        disposition: "blocked",
        status: 502,
      })
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  })
})

describe("routing an unmodified Resend client", () => {
  it("sends mail from api.resend.com to the emulator's inbox", async () => {
    const emulator = createEmulator(resend)
    const proxy = await startProxy({
      routes: [{ hosts: ["api.resend.com"], handler: emulator.fetch }],
      unmatched: "block",
    })

    try {
      const { stdout } = await run(process.execPath, [RESEND_APP], {
        env: proxy.env(),
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 30_000,
      })
      const out = JSON.parse(stdout) as { id?: string; error?: string }

      expect(out.error).toBeUndefined()

      const email = resendInbox(emulator).latest("new-user@example.com")

      expect(email).toMatchObject({ id: out.id, subject: "Your sign-in code" })
      expect(email?.code()).toBe("734120")

      await proxy.settled()
      expect(
        proxy.exchanges().map((e) => `${e.disposition} ${e.method} ${e.host}${e.path} ${e.status}`),
      ).toEqual(["routed POST api.resend.com/emails 200"])
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  })
})

describe("routing an unmodified S3 client", () => {
  it("sends a Tigris-configured client and its presigned URLs to the emulator", async () => {
    const emulator = createEmulator(s3)

    seedS3(emulator.store, { buckets: [{ name: "carbonme-qa" }] })
    const proxy = await startProxy({
      routes: [{ hosts: s3Hosts(["carbonme-qa"]), handler: emulator.fetch }],
      unmatched: "block",
    })

    try {
      const { stdout } = await run(process.execPath, [S3_APP], {
        env: proxy.env({
          ...process.env,
          TIGRIS_STORAGE_BUCKET: "carbonme-qa",
          TIGRIS_STORAGE_ACCESS_KEY_ID: "tid_from_app",
          TIGRIS_STORAGE_SECRET_ACCESS_KEY: "tsec_from_app",
        }),
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 30_000,
      })

      expect(JSON.parse(stdout)).toEqual({
        streamed: "streamed body",
        body: "hello tigris",
        keys: ["docs/hello.txt", "docs/streamed.txt"],
        presignedHost: "carbonme-qa.t3.storage.dev",
        presignedBody: "hello tigris",
      })
      expect(s3Objects(emulator).get("carbonme-qa", "docs/hello.txt")?.contentType).toBe(
        "text/plain",
      )

      await proxy.settled()
      expect(
        proxy
          .exchanges()
          .map((e) => `${e.disposition} ${e.method} ${e.host}${e.path.split("?")[0]} ${e.status}`),
      ).toEqual([
        "routed PUT carbonme-qa.t3.storage.dev/docs/hello.txt 200",
        "routed PUT carbonme-qa.t3.storage.dev/docs/streamed.txt 200",
        "routed GET carbonme-qa.t3.storage.dev/docs/streamed.txt 200",
        "routed GET carbonme-qa.t3.storage.dev/docs/hello.txt 200",
        "routed GET carbonme-qa.t3.storage.dev/ 200",
        "routed GET carbonme-qa.t3.storage.dev/docs/hello.txt 200",
      ])
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  })
})

interface Fetched {
  status?: number
  body?: string
  error?: string
}

async function fetchThrough(
  env: NodeJS.ProcessEnv,
  requests: ReadonlyArray<{ url: string; method?: string; body?: string }>,
): Promise<Fetched[]> {
  const { stdout } = await run(process.execPath, [FETCH_APP, JSON.stringify(requests)], {
    env,
    timeout: 30_000,
  })

  return JSON.parse(stdout) as Fetched[]
}

interface Received {
  method: string
  url: string
  host: string
  body: string
}

/** A plain HTTP server standing in for an outside endpoint such as MiniStack. */
async function startUpstream(): Promise<{ url: string; received: Received[]; close(): void }> {
  const received: Received[] = []
  const server = createServer((req, res) => {
    let body = ""

    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => {
      received.push({
        method: req.method ?? "",
        url: req.url ?? "",
        host: req.headers.host ?? "",
        body,
      })
      res.writeHead(201, { "content-type": "text/plain", "x-upstream": "yes" })
      res.end(`ok ${req.url ?? ""}`)
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received,
    close: () => server.close(),
  }
}

describe("routing unmodified Google and Microsoft sign-in", () => {
  it("signs in with google-auth-library and MSAL on their default hosts", async () => {
    const googleEmulator = createEmulator(google)
    const microsoftEmulator = createEmulator(microsoft)

    seedGoogle(googleEmulator.store, {
      users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }],
      oauth_clients: [
        {
          client_id: "123-app.apps.googleusercontent.com",
          client_secret: "GOCSPX-app-secret",
          name: "Acme",
          redirect_uris: ["https://app.danwo.test/auth/google/callback"],
        },
      ],
    })
    seedMicrosoft(microsoftEmulator.store, {
      users: [
        {
          email: "grace@contoso.test",
          name: "Grace Hopper",
          tenant_id: "72f988bf-86f1-41af-91ab-2d7cd011db47",
        },
      ],
      oauth_clients: [
        {
          client_id: "6731de76-14a6-49ae-97bc-6eba6914391e",
          client_secret: "Qx~8Q~app-secret",
          name: "Acme",
          redirect_uris: ["https://app.danwo.test/auth/microsoft/callback"],
        },
      ],
    })
    const proxy = await startProxy({
      routes: [
        { hosts: [...GOOGLE_HOSTS], handler: googleEmulator.fetch },
        { hosts: [...MICROSOFT_HOSTS], handler: microsoftEmulator.fetch },
      ],
      unmatched: "block",
    })

    try {
      const { stdout } = await run(process.execPath, [OAUTH_APP], {
        env: proxy.env(),
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 30_000,
      })

      expect(JSON.parse(stdout)).toEqual({
        google: { email: "ada@danwo.test", userinfo: "ada@danwo.test" },
        microsoft: { username: "grace@contoso.test", me: "Grace Hopper" },
      })

      await proxy.settled()
      const calls = proxy
        .exchanges()
        .map((e) => `${e.disposition} ${e.method} ${e.host}${e.path.split("?")[0]} ${e.status}`)

      expect(calls).toEqual(
        expect.arrayContaining([
          "routed POST oauth2.googleapis.com/token 200",
          "routed GET www.googleapis.com/oauth2/v1/certs 200",
          "routed GET openidconnect.googleapis.com/v1/userinfo 200",
          "routed POST oauth2.googleapis.com/revoke 200",
          "routed POST login.microsoftonline.com/common/oauth2/v2.0/token 200",
          "routed GET graph.microsoft.com/v1.0/me 200",
        ]),
      )
      expect(calls.every((call) => call.startsWith("routed "))).toBe(true)
    } finally {
      await proxy.stop()
      await googleEmulator.close()
      await microsoftEmulator.close()
    }
  })
})

/** A port nothing listens on yet, for a child process to open. */
async function freePort(): Promise<number> {
  const server = createServer()

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const { port } = server.address() as AddressInfo

  server.close()

  return port
}

/** Plays the user consenting to `scope` for the app, and returns the access token. */
async function googleAccessToken(
  emulator: { fetch: (r: Request) => Promise<Response> },
  scope: string,
) {
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth")

  authorize.search = new URLSearchParams({
    client_id: "123-sync.apps.googleusercontent.com",
    redirect_uri: "https://app.danwo.test/oauth/callback",
    response_type: "code",
    scope,
  }).toString()

  const page = await (await emulator.fetch(new Request(authorize))).text()
  const back = await emulator.fetch(
    new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
      method: "POST",
      body: new URLSearchParams({
        request: /name="request" value="([^"]+)"/.exec(page)?.[1] ?? "",
        user: /name="user" value="([^"]+)"/.exec(page)?.[1] ?? "",
      }),
    }),
  )
  const token = await emulator.fetch(
    new Request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? "",
        redirect_uri: "https://app.danwo.test/oauth/callback",
        client_id: "123-sync.apps.googleusercontent.com",
        client_secret: "GOCSPX-sync",
      }),
    }),
  )

  return ((await token.json()) as { access_token: string }).access_token
}

describe("routing an unmodified Google integration", () => {
  it("syncs Gmail from a watch push and falls back to a full Calendar sync on 410", async () => {
    const port = await freePort()
    const emulator = createEmulator(google)

    seedGoogle(emulator.store, {
      users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }],
      oauth_clients: [
        {
          client_id: "123-sync.apps.googleusercontent.com",
          client_secret: "GOCSPX-sync",
          name: "Sync",
          redirect_uris: ["https://app.danwo.test/oauth/callback"],
        },
      ],
      pubsub: [
        {
          subscription: "projects/app/subscriptions/gmail-push",
          topic: "projects/app/topics/gmail",
          endpoint: `http://127.0.0.1:${port}/push`,
        },
      ],
    })

    const proxy = await startProxy({
      routes: [{ hosts: [...GOOGLE_HOSTS], handler: emulator.fetch }],
      unmatched: "block",
    })
    const scope = [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar",
    ].join(" ")
    let syncs = 0

    proxy.setFault((call) => {
      const isSync = call.method === "GET" && call.path.includes("/events?syncToken=")

      if (!isSync || ++syncs !== 2) return undefined

      return googleOutboundFaults({
        method: "GET",
        path: "/calendar/v3/calendars/primary/events",
      }).find((fault) => fault.kind === "status" && fault.status === 410)
    })

    try {
      const { stdout } = await run(process.execPath, [GOOGLE_SYNC_APP], {
        env: {
          ...proxy.env(),
          ACCESS_TOKEN: await googleAccessToken(emulator, scope),
          PUSH_PORT: String(port),
        },
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 30_000,
      })

      expect(JSON.parse(stdout)).toEqual({
        gmail: { push: "ada@danwo.test", subjects: ["Note to self"] },
        calendar: {
          changed: ["Planning"],
          expired: 410,
          reason: "fullSyncRequired",
          resynced: ["Planning"],
        },
      })

      await proxy.settled()
      expect(proxy.exchanges().every((exchange) => exchange.disposition === "routed")).toBe(true)
      expect(proxy.exchanges().map((exchange) => exchange.host)).toEqual(
        expect.arrayContaining(["gmail.googleapis.com", "www.googleapis.com"]),
      )
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  })
})

describe("routing an unmodified Microsoft Graph integration", () => {
  it("subscribes with the handshake, gets a notification and syncs the inbox by delta", async () => {
    const port = await freePort()
    const emulator = createEmulator(microsoft)
    const email = "ada@danwo.test"

    seedMicrosoft(emulator, {
      users: [{ email, name: "Ada Lovelace" }],
      oauth_clients: [GRAPH_CLIENT],
      mail: [{ user: email, subject: "Welcome" }],
    })

    const proxy = await startProxy({
      routes: [{ hosts: [...MICROSOFT_HOSTS], handler: emulator.fetch }],
      unmatched: "block",
    })

    try {
      const { stdout } = await run(process.execPath, [GRAPH_SYNC_APP], {
        env: {
          ...proxy.env(),
          ACCESS_TOKEN: await graphAccessToken(emulator, "Mail.ReadWrite Mail.Send"),
          NOTIFY_PORT: String(port),
          USER_EMAIL: email,
        },
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 30_000,
      })

      expect(JSON.parse(stdout)).toEqual({
        subscribed: 201,
        firstRound: ["Welcome"],
        notification: {
          changeType: "created",
          clientState: "graph-sync-state",
          subscription: true,
        },
        changed: ["Weekly report"],
      })
      expect(outlookMailbox(emulator, email).latest("inbox")?.subject).toBe("Weekly report")

      await proxy.settled()
      expect(proxy.exchanges().every((exchange) => exchange.disposition === "routed")).toBe(true)
      expect(new Set(proxy.exchanges().map((exchange) => exchange.host))).toEqual(
        new Set(["graph.microsoft.com"]),
      )
    } finally {
      await proxy.stop()
      await emulator.close()
    }
  })
})

describe("forwarding to an upstream", () => {
  it("keeps method, path, query, Host and body, for exact and wildcard hosts", async () => {
    const upstream = await startUpstream()
    const proxy = await startProxy({
      routes: [{ hosts: ["svc.danwo.test", "*.svc.danwo.test"], upstream: upstream.url }],
      unmatched: "block",
    })

    try {
      const out = await fetchThrough(proxy.env(), [
        { url: "https://svc.danwo.test/queue?Action=Send", method: "POST", body: "hello" },
        { url: "https://bucket.eu.svc.danwo.test/key.txt" },
        { url: "https://svc.danwo.test.other/" },
      ])

      expect(out.slice(0, 2)).toEqual([
        { status: 201, body: "ok /queue?Action=Send" },
        { status: 201, body: "ok /key.txt" },
      ])
      expect(out[2]?.status).toBe(502) // a lookalike host is not covered by the wildcard
      expect(upstream.received).toEqual([
        { method: "POST", url: "/queue?Action=Send", host: "svc.danwo.test", body: "hello" },
        { method: "GET", url: "/key.txt", host: "bucket.eu.svc.danwo.test", body: "" },
      ])
      await proxy.settled()
      expect(proxy.exchanges().map((e) => e.disposition)).toEqual(["routed", "routed", "blocked"])
    } finally {
      await proxy.stop()
      upstream.close()
    }
  })

  it("sends each call to the most specific route, every time", async () => {
    const broad = await startUpstream()
    const narrow = await startUpstream()
    const proxy = await startProxy({
      routes: [
        { hosts: ["*.danwo.test"], upstream: broad.url },
        { hosts: ["*.svc.danwo.test"], upstream: narrow.url },
      ],
    })

    try {
      await fetchThrough(proxy.env(), [
        { url: "https://a.svc.danwo.test/1" },
        { url: "https://a.svc.danwo.test/2" },
        { url: "https://other.danwo.test/3" },
      ])

      expect(narrow.received.map((r) => r.url)).toEqual(["/1", "/2"])
      expect(broad.received.map((r) => r.url)).toEqual(["/3"])
    } finally {
      await proxy.stop()
      broad.close()
      narrow.close()
    }
  })

  it("captures each call's headers and text body, capped, for the flight recorder", async () => {
    const proxy = await startProxy({
      routes: [
        {
          hosts: ["api.danwo.test"],
          handler: async (request) =>
            Response.json({ received: (await request.text()).length }, { status: 201 }),
        },
      ],
      unmatched: "block",
    })

    try {
      await fetchThrough(proxy.env(), [
        { url: "https://api.danwo.test/small", method: "POST", body: "hello" },
        { url: "https://api.danwo.test/large", method: "POST", body: "x".repeat(20_000) },
      ])
      await proxy.settled()

      const [small, large] = proxy.exchanges()

      expect(small?.request).toMatchObject({ body: "hello", bytes: 5, truncated: false })
      expect(small?.request?.headers["content-type"]).toMatch(/^text\/plain/)
      expect(small?.response).toMatchObject({ body: '{"received":5}', truncated: false })
      expect(large?.request).toMatchObject({ bytes: 20_000, truncated: true })
      expect(large?.request?.body).toHaveLength(MAX_CAPTURED_BODY_BYTES)
    } finally {
      await proxy.stop()
    }
  })

  it("applies faults to forwarded calls", async () => {
    const upstream = await startUpstream()
    const proxy = await startProxy({
      routes: [{ hosts: ["*.svc.danwo.test"], upstream: upstream.url }],
    })

    proxy.setFault((call) => {
      if (call.index === 0) return { kind: "status", status: 503, body: "slow down" }
      if (call.index === 1) return { kind: "reset" }
      if (call.index === 2) return { kind: "reset-after" }

      return undefined
    })

    try {
      const out = await fetchThrough(
        proxy.env(),
        ["a", "b", "c", "d"].map((name) => ({
          url: `https://q.svc.danwo.test/${name}`,
          method: "POST",
          body: name,
        })),
      )

      expect(out[0]).toEqual({ status: 503, body: "slow down" })
      expect(out[1]?.error).toBeDefined()
      expect(out[2]?.error).toBeDefined()
      expect(out[3]).toEqual({ status: 201, body: "ok /d" })
      // The status and reset faults never reached the upstream; reset-after did, then dropped.
      expect(upstream.received.map((r) => r.body)).toEqual(["c", "d"])
      await proxy.settled()
      expect(proxy.exchanges().map((e) => e.fault)).toEqual([
        "status 503",
        "reset",
        "reset-after",
        null,
      ])
    } finally {
      await proxy.stop()
      upstream.close()
    }
  })
})

describe("env", () => {
  it("keeps the app's own NODE_OPTIONS", async () => {
    const proxy = await startProxy({ routes: [] })

    try {
      const env = proxy.env({ NODE_OPTIONS: "--max-old-space-size=512" })

      expect(env.NODE_OPTIONS).toMatch(
        /^--max-old-space-size=512 --import=file:\/\/.*preload\.mjs$/,
      )
      expect(env).toMatchObject({ HTTPS_PROXY: proxy.url, NODE_USE_ENV_PROXY: "1" })
    } finally {
      await proxy.stop()
    }
  })
})

const GRAPH_CLIENT = {
  client_id: "6731de76-14a6-49ae-97bc-6eba6914391e",
  client_secret: "Qx~8Q~graph-sync",
  name: "Graph Sync",
  redirect_uris: ["https://app.danwo.test/oauth/callback"],
}

/** Plays the user signing in to the Graph app with `scope`, and returns the access token. */
async function graphAccessToken(
  emulator: { fetch: (r: Request) => Promise<Response> },
  scope: string,
) {
  const authorize = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")

  authorize.search = new URLSearchParams({
    client_id: GRAPH_CLIENT.client_id,
    redirect_uri: GRAPH_CLIENT.redirect_uris[0] ?? "",
    response_type: "code",
    scope,
  }).toString()

  const page = await (await emulator.fetch(new Request(authorize))).text()
  const back = await emulator.fetch(
    new Request("https://login.microsoftonline.com/common/login", {
      method: "POST",
      body: new URLSearchParams({
        request: /name="request" value="([^"]+)"/.exec(page)?.[1] ?? "",
        user: /name="user" value="([^"]+)"/.exec(page)?.[1] ?? "",
      }),
    }),
  )
  const token = await emulator.fetch(
    new Request("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: new URL(back.headers.get("location") ?? "").searchParams.get("code") ?? "",
        redirect_uri: GRAPH_CLIENT.redirect_uris[0] ?? "",
        client_id: GRAPH_CLIENT.client_id,
        client_secret: GRAPH_CLIENT.client_secret,
        scope,
      }),
    }),
  )

  return ((await token.json()) as { access_token: string }).access_token
}
