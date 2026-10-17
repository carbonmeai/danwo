import { beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { seedSlack, slack, slackWorkspace } from "../src/slack/index.ts"
import { ManualClock } from "../src/time.ts"
import { APP, clientFor, slackError, WORKSPACE } from "./slack-workspace.ts"

const REDIRECT = "https://app.danwo.test/slack/oauth"

let emulator: Emulator
let clock: ManualClock

function start(app: Partial<typeof APP> & { token_rotation?: boolean } = {}) {
  clock = new ManualClock(new Date())
  emulator = createEmulator(slack, { clock: clock.clock, timer: clock.timer })
  seedSlack(emulator.store, { ...WORKSPACE, apps: [{ ...APP, ...app }], installations: [] })
}

beforeEach(() => start())

const pick = (pattern: RegExp, text: string) => pattern.exec(text)?.[1] ?? ""

/** Opens the consent page and answers it as `email`, or cancels; returns where Slack sent the browser. */
async function consent(query: Record<string, string>, email?: string): Promise<URL> {
  const url = `https://slack.com/oauth/v2/authorize?${new URLSearchParams(query).toString()}`
  const page = await emulator.fetch(new Request(url))
  const html = await page.text()
  const request = pick(/name="request" value="([^"]+)"/, html)
  const item = html.split("<li>").find((li) => email !== undefined && li.includes(email)) ?? ""
  const choice =
    email === undefined ? { deny: "1" } : { user: pick(/name="user" value="([^"]+)"/, item) }
  const answer = await emulator.fetch(
    new Request("https://slack.com/oauth/v2/authorize", {
      method: "POST",
      body: new URLSearchParams({ request, ...choice }),
    }),
  )

  return new URL(answer.headers.get("location") ?? "")
}

const INSTALL = {
  client_id: APP.client_id,
  scope: "chat:write,channels:read,incoming-webhook",
  user_scope: "users:read",
  redirect_uri: REDIRECT,
  state: "st-123",
}

async function install() {
  const back = await consent(INSTALL, "ada@danwo.test")

  return clientFor(emulator).oauth.v2.access({
    client_id: APP.client_id,
    client_secret: APP.client_secret,
    code: back.searchParams.get("code") ?? "",
    redirect_uri: REDIRECT,
  })
}

describe("installing through OAuth v2", () => {
  it("hands back a code and the state, then exchanges it for bot and user tokens and a webhook", async () => {
    const back = await consent(INSTALL, "ada@danwo.test")

    expect(back.origin + back.pathname).toBe(REDIRECT)
    expect(back.searchParams.get("state")).toBe("st-123")

    const granted = await clientFor(emulator).oauth.v2.access({
      client_id: APP.client_id,
      client_secret: APP.client_secret,
      code: back.searchParams.get("code") ?? "",
      redirect_uri: REDIRECT,
    })

    expect(granted).toMatchObject({
      ok: true,
      app_id: APP.app_id,
      token_type: "bot",
      scope: "chat:write,channels:read,incoming-webhook",
      team: { id: "T0DANWO0001", name: "Danwo QA" },
      authed_user: { token_type: "user", scope: "users:read" },
      incoming_webhook: { channel: "#general" },
    })
    expect(granted.access_token).toMatch(/^xoxb-/)
    expect(granted.authed_user?.access_token).toMatch(/^xoxp-/)
    expect((await clientFor(emulator, granted.access_token).auth.test()).user_id).toBe(
      granted.bot_user_id,
    )
  })

  it("posts through the incoming webhook it granted", async () => {
    const granted = await install()
    const response = await emulator.fetch(
      new Request(granted.incoming_webhook?.url ?? "", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Deployed v2" }),
      }),
    )

    expect(await response.text()).toBe("ok")
    expect(
      slackWorkspace(emulator)
        .messages("general")
        .map((m) => m.text),
    ).toEqual(["Deployed v2"])
  })

  it("refuses a wrong secret, a reused code and a different redirect URI", async () => {
    const back = await consent(INSTALL, "ada@danwo.test")
    const code = back.searchParams.get("code") ?? ""
    const client = clientFor(emulator)
    const args = { client_id: APP.client_id, client_secret: APP.client_secret, code }

    expect(
      (await slackError(client.oauth.v2.access({ ...args, client_secret: "wrong" }))).error,
    ).toBe("bad_client_secret")
    expect(
      (await slackError(client.oauth.v2.access({ ...args, redirect_uri: "https://evil.test/cb" })))
        .error,
    ).toBe("bad_redirect_uri")
    await client.oauth.v2.access(args).catch(() => undefined)
    expect((await slackError(client.oauth.v2.access(args))).error).toBe("invalid_code")
  })

  it("sends a cancelled install back with access_denied", async () => {
    const back = await consent(INSTALL)

    expect(back.searchParams.get("error")).toBe("access_denied")
    expect(back.searchParams.get("state")).toBe("st-123")
  })

  it("shows an error page for an unknown client or an unregistered redirect URI", async () => {
    const unknown = await emulator.fetch(
      new Request("https://slack.com/oauth/v2/authorize?client_id=nope&scope=chat:write"),
    )
    const elsewhere = await emulator.fetch(
      new Request(
        `https://slack.com/oauth/v2/authorize?client_id=${APP.client_id}&scope=chat:write&redirect_uri=https://evil.test/cb`,
      ),
    )

    expect(unknown.status).toBe(400)
    expect(await unknown.text()).toContain("invalid_client_id")
    expect(await elsewhere.text()).toContain("bad_redirect_uri")
  })
})

describe("tokens", () => {
  it("rotates: a twelve-hour token, then a refresh that spends the old refresh token", async () => {
    start({ token_rotation: true })

    const granted = await install()

    expect(granted.access_token).toMatch(/^xoxe\.xoxb-/)
    expect(granted).toMatchObject({
      expires_in: 43_200,
      refresh_token: expect.stringMatching(/^xoxe-1-/),
    })

    clock.advance(43_200_000)
    expect((await slackError(clientFor(emulator, granted.access_token).auth.test())).error).toBe(
      "token_expired",
    )

    const refresh = {
      client_id: APP.client_id,
      client_secret: APP.client_secret,
      grant_type: "refresh_token" as const,
      refresh_token: granted.refresh_token ?? "",
    }
    const renewed = await clientFor(emulator).oauth.v2.access(refresh)

    expect(renewed.access_token).not.toBe(granted.access_token)
    expect((await clientFor(emulator, renewed.access_token).auth.test()).ok).toBe(true)
    expect((await slackError(clientFor(emulator).oauth.v2.access(refresh))).error).toBe(
      "invalid_refresh_token",
    )
  })

  it("revokes a token with auth.revoke", async () => {
    const granted = await install()
    const bot = clientFor(emulator, granted.access_token)

    expect(await bot.auth.revoke({})).toMatchObject({ ok: true, revoked: true })
    expect((await slackError(bot.auth.test())).error).toBe("token_revoked")
  })
})
