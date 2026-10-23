import { once } from "node:events"
import { createServer, type Server } from "node:http"

import type { ViewsOpenArguments } from "@slack/web-api"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { listeningPort } from "../src/net.ts"
import { seedSlack, slack, slackWorkspace } from "../src/slack/index.ts"
import { ManualClock } from "../src/time.ts"
import { fakeKey } from "./fake-key.ts"
import { APP, BOT_TOKEN, clientFor, postMessage, slackError, WORKSPACE } from "./slack-workspace.ts"

/** The installer's user token, with the admin scope for channel conversions. */
const USER_TOKEN = fakeKey("xoxp-", "1111111111111-3333333333333-seededusertoken00000000")

/** One request Slack sent the app. */
interface Received {
  readonly path: string
  readonly body: string
}

/**
 * The app under test, as a bare HTTP server: it records every event and interaction and answers
 * interactions with `answer`, which a test sets before it acts.
 */
const app = {
  server: undefined as Server | undefined,
  url: "",
  received: [] as Received[],
  answer: "",
  status: 200,
}

/** The bodies of the requests to `path`, parsed. */
function parsed(path: string, read: (body: string) => string): Record<string, unknown>[] {
  return app.received
    .filter((request) => request.path === path)
    .map((request): Record<string, unknown> => JSON.parse(read(request.body)))
}

/** The inner events the app was sent, in order, each with its envelope under `envelope`. */
function events(): Record<string, unknown>[] {
  return parsed("/events", (body) => body).map((envelope) => ({
    ...Object(envelope.event),
    envelope,
  }))
}

/** The interaction payloads the app was sent, in order. */
function interactions(): Record<string, unknown>[] {
  return parsed("/interactions", (body) => new URLSearchParams(body).get("payload") ?? "{}")
}

beforeAll(async () => {
  app.server = createServer((req, res) => {
    let body = ""

    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => {
      app.received.push({ path: req.url ?? "", body })
      res.statusCode = app.status
      if (req.url === "/interactions" && app.answer !== "") {
        res.setHeader("content-type", "application/json")
        res.end(app.answer)
      } else res.end()
    })
  })
  app.server.listen(0, "127.0.0.1")
  await once(app.server, "listening")
  app.url = `http://127.0.0.1:${listeningPort(app.server)}`
})

afterAll(() => {
  app.server?.close()
})

let emulator: Emulator
let clock: ManualClock

beforeEach(() => {
  app.received = []
  app.answer = ""
  app.status = 200
  clock = new ManualClock(new Date())
  emulator = createEmulator(slack, { clock: clock.clock, timer: clock.timer })
  seedSlack(emulator.store, {
    ...WORKSPACE,
    users: [
      ...(WORKSPACE.users ?? []),
      { name: "pat", email: "pat@partner.test", real_name: "Pat Partner", team_id: "T0PARTNER01" },
    ],
    apps: [
      {
        ...APP,
        bot_scopes: [...APP.bot_scopes, "groups:history"],
        user_scopes: ["admin.conversations:write", "channels:read"],
        events: {
          url: `${app.url}/events`,
          bot_events: [
            "message.channels",
            "message.groups",
            "member_left_channel",
            "channel_left",
            "group_left",
            "app_uninstalled",
            "tokens_revoked",
          ],
        },
        interactivity_url: `${app.url}/interactions`,
      },
    ],
    installations: [
      {
        app: APP.client_id,
        installer: "ada",
        bot_token: BOT_TOKEN,
        user_token: USER_TOKEN,
        channels: ["general", "random"],
      },
    ],
  })
})

afterEach(async () => {
  await emulator.close()
})

/** Lets every queued delivery go out and waits for the app's answers. */
async function settled(): Promise<void> {
  clock.advance(0)
  await emulator.webhooks?.idle()
}

/** The bot user's id, from `auth.test`. */
async function botUser(): Promise<string> {
  return (await clientFor(emulator, BOT_TOKEN).auth.test()).user_id ?? ""
}

/** A channel's id by name. */
async function channelId(name: string): Promise<string> {
  const list = await clientFor(emulator, USER_TOKEN).conversations.list({
    types: "public_channel,private_channel",
  })

  return list.channels?.find((channel) => channel.name === name)?.id ?? ""
}

describe("uninstalling the app", () => {
  it("revokes its tokens before telling it with app_uninstalled and tokens_revoked", async () => {
    const result = await clientFor(emulator, USER_TOKEN).apps.uninstall({
      client_id: APP.client_id,
      client_secret: APP.client_secret,
    })
    const bot = await botUser().catch(() => "")

    expect(result.ok).toBe(true)
    expect(await slackError(clientFor(emulator, BOT_TOKEN).auth.test())).toMatchObject({
      error: "token_revoked",
    })
    expect(bot).toBe("")
    await settled()

    expect(events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "app_uninstalled" }),
        expect.objectContaining({
          type: "tokens_revoked",
          tokens: { oauth: [expect.stringMatching(/^U/)], bot: [expect.stringMatching(/^U/)] },
        }),
      ]),
    )
  })

  it("refuses a bot token and a wrong secret", async () => {
    expect(
      await slackError(
        clientFor(emulator, BOT_TOKEN).apps.uninstall({
          client_id: APP.client_id,
          client_secret: APP.client_secret,
        }),
      ),
    ).toMatchObject({ error: "no_permission" })
    expect(
      await slackError(
        clientFor(emulator, USER_TOKEN).apps.uninstall({
          client_id: APP.client_id,
          client_secret: "wrong",
        }),
      ),
    ).toMatchObject({ error: "bad_client_secret" })
  })

  it("happens from the workspace's side too, as an admin removing the app", async () => {
    slackWorkspace(emulator).uninstall()
    await settled()

    expect(
      events()
        .map((event) => String(event.type))
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["app_uninstalled", "tokens_revoked"])
    expect(await slackError(clientFor(emulator, USER_TOKEN).auth.test())).toMatchObject({
      error: "token_revoked",
    })
  })
})

describe("leaving channels", () => {
  it("tells the app its bot was removed, and by whom, with channel_left", async () => {
    const workspace = slackWorkspace(emulator)
    const bot = await botUser()

    workspace.leave(bot, "random", "grace")
    await settled()

    const grace = (
      await clientFor(emulator, BOT_TOKEN).users.lookupByEmail({
        email: "grace@danwo.test",
      })
    ).user?.id

    expect(events().find((event) => event.type === "channel_left")).toMatchObject({
      channel: await channelId("random"),
      actor_id: grace,
    })
  })

  it("sends member_left_channel when a member leaves a channel the bot is in", async () => {
    slackWorkspace(emulator).leave("grace", "random")
    await settled()

    expect(events()).toEqual([
      expect.objectContaining({ type: "member_left_channel", channel_type: "C" }),
    ])
  })

  it("lets the bot leave and kick through the API, but never out of #general", async () => {
    const client = clientFor(emulator, BOT_TOKEN)
    const random = await channelId("random")
    const general = await channelId("general")
    const grace = (await client.users.lookupByEmail({ email: "grace@danwo.test" })).user?.id ?? ""

    await client.conversations.kick({ channel: random, user: grace })
    expect(await slackError(client.conversations.leave({ channel: general }))).toMatchObject({
      error: "cant_leave_general",
    })
    await client.conversations.leave({ channel: random })
    expect(await client.conversations.leave({ channel: random })).toMatchObject({
      ok: true,
      not_in_channel: true,
    })
    await settled()

    expect(events().map((event) => event.type)).toEqual(["member_left_channel", "channel_left"])
  })
})

describe("converting a channel's privacy", () => {
  it("makes a channel private for an admin and tells the apps in it", async () => {
    const random = await channelId("random")
    const ada = clientFor(emulator, USER_TOKEN)

    await ada.admin.conversations.convertToPrivate({ channel_id: random })

    const info = await ada.conversations.info({ channel: random })

    expect(info.channel).toMatchObject({ id: random, is_private: true })
    await settled()
    expect(events()).toEqual([
      expect.objectContaining({
        type: "message",
        subtype: "channel_convert_to_private",
        channel: random,
        channel_type: "group",
      }),
    ])
    expect(
      await slackError(ada.admin.conversations.convertToPrivate({ channel_id: random })),
    ).toMatchObject({ error: "could_not_convert_channel" })
    await ada.admin.conversations.convertToPublic({ channel_id: random })
    expect((await ada.conversations.info({ channel: random })).channel?.is_private).toBe(false)
  })

  it("refuses a bot token and #general", async () => {
    const general = await channelId("general")
    const random = await channelId("random")

    expect(
      await slackError(
        clientFor(emulator, BOT_TOKEN).admin.conversations.convertToPrivate({ channel_id: random }),
      ),
    ).toMatchObject({ error: "not_allowed_token_type" })
    expect(
      await slackError(
        clientFor(emulator, USER_TOKEN).admin.conversations.convertToPrivate({
          channel_id: general,
        }),
      ),
    ).toMatchObject({ error: "default_org_wide_channel" })
  })

  it("converts from the workspace's side too, as an admin in Slack's settings", async () => {
    slackWorkspace(emulator).convert("ada", "random", "private")

    const info = await clientFor(emulator, USER_TOKEN).conversations.info({
      channel: await channelId("random"),
    })

    expect(info.channel?.is_private).toBe(true)
  })
})

describe("Slack Connect", () => {
  it("shares a channel once a member from another workspace joins it", async () => {
    const workspace = slackWorkspace(emulator)
    const random = await channelId("random")
    const client = clientFor(emulator, BOT_TOKEN)

    expect((await client.conversations.info({ channel: random })).channel?.is_ext_shared).toBe(
      false,
    )
    workspace.join("pat", "random")
    workspace.post("pat", "random", "Hello from the partner side")

    const info = await client.conversations.info({ channel: random })
    const pat = await client.users.lookupByEmail({ email: "pat@partner.test" })

    expect(info.channel).toMatchObject({ is_shared: true, is_ext_shared: true })
    expect(pat.user).toMatchObject({ team_id: "T0PARTNER01", is_stranger: false })
    await settled()

    const message = events().find((event) => event.type === "message")

    expect(message).toMatchObject({ user_team: "T0PARTNER01", source_team: "T0PARTNER01" })
    expect(message?.envelope).toMatchObject({ is_ext_shared_channel: true })
  })
})

const MODAL = {
  type: "modal",
  callback_id: "deploy",
  title: { type: "plain_text", text: "Deploy" },
  submit: { type: "plain_text", text: "Go" },
  notify_on_close: true,
  blocks: [
    {
      type: "input",
      block_id: "env",
      label: { type: "plain_text", text: "Environment" },
      element: { type: "plain_text_input", action_id: "name" },
    },
  ],
} satisfies ViewsOpenArguments["view"]

/** Opens the modal for ada through a button click's trigger, and returns its id. */
async function openModal(): Promise<string> {
  const client = clientFor(emulator, BOT_TOKEN)
  const general = await channelId("general")
  const posted = await postMessage(client, {
    channel: general,
    text: "Deploy?",
    blocks: [
      {
        type: "actions",
        elements: [
          { type: "button", action_id: "deploy", text: { type: "plain_text", text: "Deploy" } },
        ],
      },
    ],
  })

  slackWorkspace(emulator).click("ada", "general", posted.ts ?? "", { actionId: "deploy" })
  await settled()

  const trigger = String(interactions().at(-1)?.trigger_id)
  const opened = await client.views.open({ trigger_id: trigger, view: MODAL })

  return opened.view?.id ?? ""
}

const values = { env: { name: { type: "plain_text_input", value: "prod" } } }

/** Submits ada's modal with the app answering `answer`, and waits for the answer to land. */
async function submitAnswered(viewId: string, answer: unknown): Promise<void> {
  app.answer = typeof answer === "string" ? answer : JSON.stringify(answer)
  slackWorkspace(emulator).submit("ada", viewId, values)
  await settled()
}

describe("answering a modal submission", () => {
  it("closes the modal on an empty answer", async () => {
    const id = await openModal()

    await submitAnswered(id, "")
    expect(slackWorkspace(emulator).views("ada")).toEqual([])
  })

  it("keeps the modal open with the block errors the app answered", async () => {
    const id = await openModal()

    await submitAnswered(id, { response_action: "errors", errors: { env: "Pick staging first" } })
    expect(slackWorkspace(emulator).views("ada")).toEqual([
      expect.objectContaining({ id, errors: { env: "Pick staging first" } }),
    ])
  })

  it("replaces the modal on update", async () => {
    const id = await openModal()

    await submitAnswered(id, {
      response_action: "update",
      view: { ...MODAL, callback_id: "confirm", title: { type: "plain_text", text: "Sure?" } },
    })
    expect(slackWorkspace(emulator).views("ada")).toEqual([
      expect.objectContaining({ id, callback_id: "confirm" }),
    ])
  })

  it("stacks a pushed view, three deep at most, and clears the stack", async () => {
    const id = await openModal()
    const push = { response_action: "push", view: { ...MODAL, callback_id: "step" } }

    await submitAnswered(id, push)

    const second = slackWorkspace(emulator).views("ada")[1]

    expect(second).toMatchObject({ callback_id: "step" })
    await submitAnswered(String(second?.id), push)
    await submitAnswered(String(slackWorkspace(emulator).views("ada")[2]?.id), push)
    expect(slackWorkspace(emulator).views("ada")).toHaveLength(3)
    await submitAnswered(id, { response_action: "clear" })
    expect(slackWorkspace(emulator).views("ada")).toEqual([])
  })

  it("leaves the modal open when the answer makes no sense to Slack", async () => {
    const id = await openModal()

    await submitAnswered(id, "not json")
    await submitAnswered(id, { response_action: "errors", errors: { env: 42 } })
    expect(slackWorkspace(emulator).views("ada")).toEqual([expect.objectContaining({ id })])
  })

  it("sends a submission once, never retried, and leaves the modal open when the app fails", async () => {
    const id = await openModal()

    app.status = 500
    slackWorkspace(emulator).submit("ada", id, values)
    await settled()

    for (const wait of [1_000, 60_000, 300_000]) {
      clock.advance(wait)
      await emulator.webhooks?.idle()
    }

    const submissions = interactions().filter((payload) => payload.type === "view_submission")

    expect(submissions).toHaveLength(1)
    expect(slackWorkspace(emulator).views("ada")).toEqual([expect.objectContaining({ id })])
  })

  it("sends view_closed when the member closes a modal that asked for it", async () => {
    const id = await openModal()

    slackWorkspace(emulator).close("ada", id)
    await settled()
    expect(slackWorkspace(emulator).views("ada")).toEqual([])
    expect(interactions().at(-1)).toMatchObject({
      type: "view_closed",
      view: { id, callback_id: "deploy" },
      is_cleared: false,
    })
  })
})
