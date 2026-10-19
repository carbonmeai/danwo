import { AuthScheme, type Composio } from "@composio/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { composioProject, composioTools } from "../src/composio/index.ts"
import type { Emulator } from "../src/define.ts"
import { ManualClock } from "../src/time.ts"
import {
  API,
  API_KEY,
  call,
  composioWith,
  follow,
  router,
  schemaWarnings,
  sdk,
} from "./composio-client.ts"

const APP_CALLBACK = "https://app.danwo.test/composio/callback"
const WEBHOOK_URL = "https://app.danwo.test/webhooks/composio"
const WEBHOOK_SECRET = "composio-webhook-secret"

/** Warnings the SDK logged, such as a response that failed its own schema. */
const warnings: string[] = []

describe("Composio emulator: keys", () => {
  it("answers a call without a key with Auth_NoAuthProvided", async () => {
    const response = await composioWith().fetch(new Request(`${API}/toolkits`))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: {
        code: 906,
        slug: "Auth_NoAuthProvided",
        status: 401,
        message: "No authentication provided",
      },
    })
  })

  it("masks an unknown key in APIKey_InvalidAPIKey, and keeps to the seeded keys", async () => {
    const emulator = composioWith({ apiKeys: ["ak_only_this_one"] })
    const response = await emulator.fetch(
      new Request(`${API}/toolkits`, { headers: { "x-api-key": "ak_something_else1234" } }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: { code: 801, slug: "APIKey_InvalidAPIKey", message: "Invalid API key: ak_**1234" },
    })
  })

  it("serves both API versions", async () => {
    const emulator = composioWith()
    const v3 = await emulator.fetch(
      new Request("https://backend.composio.dev/api/v3/toolkits/gmail", {
        headers: { "x-api-key": API_KEY },
      }),
    )

    expect(v3.status).toBe(200)
    expect((await call(emulator, "GET", "/toolkits/gmail")).body).toMatchObject({ slug: "gmail" })
  })
})

describe("Composio emulator: through the SDK", () => {
  let emulator: Emulator
  let client: Composio
  let restore: () => void
  const delivered: { headers: Record<string, string>; body: string }[] = []
  const clock = new ManualClock(new Date())

  beforeEach(() => {
    warnings.length = 0
    delivered.length = 0
    emulator = composioWith(
      { webhook: { url: WEBHOOK_URL, secret: WEBHOOK_SECRET } },
      {
        clock: clock.clock,
        timer: clock.timer,
        fetch: async (input, init) => {
          const request = new Request(input, init)

          delivered.push({
            headers: Object.fromEntries(request.headers),
            body: await request.text(),
          })

          return new Response(null, { status: 200 })
        },
      },
    )
    const started = sdk(
      router({ "backend.composio.dev": emulator, "connect.composio.dev": emulator }),
      warnings,
    )

    client = started.client
    restore = () => started.restore()
  })

  afterEach(() => restore())

  it("lists toolkits and reads a tool's schema", async () => {
    const toolkits = await client.toolkits.get({})
    const tool = await client.tools.getRawComposioToolBySlug("GMAIL_SEND_EMAIL")

    expect(toolkits.map((toolkit) => toolkit.slug)).toEqual(
      expect.arrayContaining(["gmail", "slack", "github", "outlook"]),
    )
    expect(tool).toMatchObject({ slug: "GMAIL_SEND_EMAIL", toolkit: { slug: "gmail" } })
    expect(tool.inputParameters).toMatchObject({ required: ["body"] })
    expect(schemaWarnings(warnings)).toEqual([])
  })

  it("connects an account through the hosted link and runs a tool on it", async () => {
    const config = await client.authConfigs.create("gmail", { type: "use_composio_managed_auth" })
    const request = await client.connectedAccounts.link("ada", config.id, {
      callbackUrl: APP_CALLBACK,
    })
    const back = new URL(
      await follow(
        router({ "connect.composio.dev": emulator }),
        request.redirectUrl ?? "",
        (page) =>
          page.includes('name="decision"')
            ? { action: "", form: { decision: "allow", account: "ada@danwo.test" } }
            : undefined,
      ),
    )

    expect(back.origin + back.pathname).toBe(APP_CALLBACK)
    expect(back.searchParams.get("status")).toBe("success")
    expect(back.searchParams.get("connected_account_id")).toBe(request.id)

    const account = await request.waitForConnection(2_000)

    expect(account.status).toBe("ACTIVE")
    expect(composioProject(emulator).accounts()).toMatchObject([
      { userId: "ada", label: "ada@danwo.test" },
    ])

    const sent = await client.tools.execute("GMAIL_SEND_EMAIL", {
      userId: "ada",
      arguments: { recipient_email: "bob@danwo.test", subject: "Hi", body: "Hello" },
      dangerouslySkipVersionCheck: true,
    })

    expect(sent).toMatchObject({ successful: true, error: null, data: { labelIds: ["SENT"] } })
    expect(composioProject(emulator).executions()).toMatchObject([
      { tool: "GMAIL_SEND_EMAIL", userId: "ada", source: "sample", successful: true },
    ])
    expect(schemaWarnings(warnings)).toEqual([])
  })

  it("fails the connection when the user cancels", async () => {
    const config = await client.authConfigs.create("slack", { type: "use_composio_managed_auth" })
    const request = await client.connectedAccounts.link("ada", config.id, {
      callbackUrl: APP_CALLBACK,
    })
    const back = new URL(
      await follow(router({ "connect.composio.dev": emulator }), request.redirectUrl ?? "", () => ({
        action: "",
        form: { decision: "deny" },
      })),
    )

    expect(back.searchParams.get("status")).toBe("failed")
    await expect(request.waitForConnection(2_000)).rejects.toThrow(/FAILED/)
  })

  it("connects at once with credentials, and answers from seeded results and handlers", async () => {
    const config = await client.authConfigs.create("github", {
      type: "use_custom_auth",
      authScheme: "API_KEY",
      credentials: {},
    })

    await client.connectedAccounts.initiate("ada", config.id, {
      config: AuthScheme.APIKey({ api_key: "ghp_test" }),
    })
    composioTools(emulator).handle("GITHUB_CREATE_AN_ISSUE", (args) => ({
      number: 7,
      title: args["title"],
    }))

    const created = await client.tools.execute("GITHUB_CREATE_AN_ISSUE", {
      userId: "ada",
      arguments: { owner: "acme", repo: "app", title: "Broken" },
      dangerouslySkipVersionCheck: true,
    })

    expect(created).toMatchObject({ successful: true, data: { number: 7, title: "Broken" } })
    expect(composioProject(emulator).executions()).toMatchObject([{ source: "seeded" }])
  })

  it("refuses a tool call with missing arguments or no account", async () => {
    await expect(
      client.tools.execute("GITHUB_CREATE_AN_ISSUE", {
        userId: "ada",
        arguments: { owner: "acme" },
        dangerouslySkipVersionCheck: true,
      }),
    ).rejects.toThrow("Error executing the tool GITHUB_CREATE_AN_ISSUE")

    expect(
      await call(emulator, "POST", "/tools/execute/GITHUB_CREATE_AN_ISSUE", {
        user_id: "ada",
        arguments: { owner: "acme" },
      }),
    ).toMatchObject({
      status: 400,
      body: { error: { message: "Missing required argument(s): repo, title" } },
    })

    const noAccount = await call(emulator, "POST", "/tools/execute/GMAIL_SEND_EMAIL", {
      user_id: "nobody",
      arguments: { body: "x" },
    })

    expect(noAccount).toMatchObject({
      status: 404,
      body: { error: { slug: "ConnectedAccount_NotFoundForUser" } },
    })
  })

  it("delivers a fired trigger as a webhook the SDK verifies", async () => {
    const account = await call(emulator, "POST", "/connected_accounts", {
      auth_config: {
        id: (await client.authConfigs.create("github", { type: "use_composio_managed_auth" })).id,
      },
      connection: {
        user_id: "ada",
        state: { authScheme: "OAUTH2", val: { access_token: "gho_test" } },
      },
    })
    const { triggerId } = await client.triggers.create("ada", "GITHUB_COMMIT_EVENT", {
      triggerConfig: { owner: "acme", repo: "app" },
    })

    expect(
      composioProject(emulator).fire("GITHUB_COMMIT_EVENT", { id: "abc123", message: "Fix" }),
    ).toBe(1)
    clock.advance(1)
    await emulator.webhooks?.idle()

    const [webhook] = delivered
    const verified = await client.triggers.verifyWebhook({
      payload: webhook?.body ?? "",
      signature: webhook?.headers["webhook-signature"] ?? "",
      id: webhook?.headers["webhook-id"] ?? "",
      timestamp: webhook?.headers["webhook-timestamp"] ?? "",
      secret: WEBHOOK_SECRET,
      tolerance: 0,
    })

    expect(verified.version).toBe("V3")
    expect(verified.payload).toMatchObject({
      id: triggerId,
      triggerSlug: "GITHUB_COMMIT_EVENT",
      userId: "ada",
      payload: { id: "abc123", message: "Fix" },
      metadata: { connectedAccount: { id: account.body["id"] } },
    })
  })

  it("sends the expiry webhook when an account expires", async () => {
    const config = await client.authConfigs.create("gmail", { type: "use_composio_managed_auth" })
    const account = await call(emulator, "POST", "/connected_accounts", {
      auth_config: { id: config.id },
      connection: { user_id: "ada", state: { authScheme: "OAUTH2", val: { access_token: "t" } } },
    })

    composioProject(emulator).expire(String(account.body["id"]))
    clock.advance(1)
    await emulator.webhooks?.idle()

    expect(JSON.parse(delivered[0]?.body ?? "{}")).toMatchObject({
      type: "composio.connected_account.expired",
      data: { id: account.body["id"], status: "EXPIRED" },
    })
    expect((await client.connectedAccounts.get(String(account.body["id"]))).status).toBe("EXPIRED")
  })
})
