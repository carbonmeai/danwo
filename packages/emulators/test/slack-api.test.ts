import { beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { seedSlack, slack, slackOutboundFaults, slackWorkspace } from "../src/slack/index.ts"
import { slackStore } from "../src/slack/store.ts"
import { ManualClock } from "../src/time.ts"
import { APP, BOT_TOKEN, clientFor, postMessage, slackError, WORKSPACE } from "./slack-workspace.ts"

let emulator: Emulator
let clock: ManualClock

beforeEach(() => {
  clock = new ManualClock(new Date())
  emulator = createEmulator(slack, { clock: clock.clock, timer: clock.timer })
  seedSlack(emulator.store, WORKSPACE)
})

const bot = () => clientFor(emulator, BOT_TOKEN)

/** A channel's id, read through the API the way an app would. */
async function channelId(name: string): Promise<string> {
  const { channels = [] } = await bot().conversations.list({ types: "public_channel" })

  return channels.find((channel) => channel.name === name)?.id ?? ""
}

describe("auth", () => {
  it("identifies the bot token's user, team and app", async () => {
    const info = await bot().auth.test()

    expect(info).toMatchObject({ ok: true, team: "Danwo QA", team_id: "T0DANWO0001" })
    expect(info.bot_id).toMatch(/^B/)
    expect(info.app_id).toBe(APP.app_id)
  })

  it("answers an unknown token with invalid_auth and none with not_authed", async () => {
    expect(await slackError(clientFor(emulator, "xoxb-nope").auth.test())).toMatchObject({
      ok: false,
      error: "invalid_auth",
    })
    expect(await slackError(clientFor(emulator).auth.test())).toMatchObject({ error: "not_authed" })
  })

  it("answers a method it does not know with unknown_method", async () => {
    expect((await slackError(bot().apiCall("im.history", {}))).error).toBe("unknown_method")
  })
})

describe("scopes", () => {
  it("answers missing_scope with what was needed and what the token has", async () => {
    seedSlack(emulator.store, {
      apps: [
        {
          ...APP,
          app_id: "A0NARROW001",
          name: "Narrow",
          client_id: "9.9",
          bot_scopes: ["chat:write"],
        },
      ],
      installations: [{ app: "9.9", bot_token: "REDACTED-TEST-VALUE" }],
    })

    const data = await slackError(clientFor(emulator, "REDACTED-TEST-VALUE").users.list({}))

    expect(data).toMatchObject({
      ok: false,
      error: "missing_scope",
      needed: "users:read",
      provided: "chat:write",
    })
  })
})

describe("chat and conversations", () => {
  it("needs the bot in the channel, then posts, threads, edits and deletes", async () => {
    const general = await channelId("general")
    const notIn = await slackError(postMessage(bot(), { channel: general, text: "hello" }))

    expect(notIn.error).toBe("not_in_channel")

    const joined = await bot().conversations.join({ channel: general })

    expect(joined.channel?.is_member).toBe(true)

    const posted = await postMessage(bot(), { channel: general, text: "Standup in 5" })

    expect(posted.message).toMatchObject({
      text: "Standup in 5",
      bot_id: expect.stringMatching(/^B/),
    })

    const reply = await postMessage(bot(), {
      channel: general,
      text: "notes",
      thread_ts: posted.ts ?? "",
    })

    await bot().chat.update({ channel: general, ts: posted.ts ?? "", text: "Standup in 10" })

    const history = await bot().conversations.history({ channel: general })

    expect(history.messages?.map((m) => m.text)).toEqual(["Standup in 10"])
    expect(history.messages?.[0]).toMatchObject({ reply_count: 1, edited: expect.any(Object) })

    const thread = await bot().conversations.replies({ channel: general, ts: posted.ts ?? "" })

    expect(thread.messages?.map((m) => m.ts)).toEqual([posted.ts, reply.ts])

    await bot().chat.delete({ channel: general, ts: reply.ts ?? "" })
    expect(slackWorkspace(emulator).thread("general", posted.ts ?? "")).toHaveLength(1)
  })

  it("refuses an empty message and someone else's message", async () => {
    const random = await channelId("random")

    await bot().conversations.join({ channel: random })

    const ts = slackWorkspace(emulator).post("ada", "random", "mine")

    expect((await slackError(postMessage(bot(), { channel: random, text: "" }))).error).toBe(
      "no_text",
    )
    expect((await slackError(bot().chat.update({ channel: random, ts, text: "x" }))).error).toBe(
      "cant_update_message",
    )
  })

  it("pages conversations.list with a cursor and hides private channels from non-members", async () => {
    const first = await bot().conversations.list({
      limit: 1,
      types: "public_channel,private_channel",
    })

    expect(first.channels).toHaveLength(1)
    expect(first.response_metadata?.next_cursor).not.toBe("")

    const names: string[] = []
    let cursor: string | undefined

    do {
      const page = await bot().conversations.list({
        limit: 1,
        types: "public_channel,private_channel",
        ...(cursor !== undefined && { cursor }),
      })

      names.push(...(page.channels ?? []).map((channel) => channel.name ?? ""))
      cursor = page.response_metadata?.next_cursor || undefined
    } while (cursor !== undefined)

    expect(names.toSorted()).toEqual(["general", "random"])
  })

  it("creates a channel, invites a member and opens a DM", async () => {
    const created = await bot().conversations.create({ name: "launch" })
    const ada = (await bot().users.lookupByEmail({ email: "ada@danwo.test" })).user?.id ?? ""

    await bot().conversations.invite({ channel: created.channel?.id ?? "", users: ada })

    const members = await bot().conversations.members({ channel: created.channel?.id ?? "" })

    expect(members.members).toContain(ada)
    expect((await slackError(bot().conversations.create({ name: "launch" }))).error).toBe(
      "name_taken",
    )
    expect((await slackError(bot().conversations.create({ name: "Bad Name" }))).error).toBe(
      "invalid_name_specials",
    )

    const dm = await bot().conversations.open({ users: ada })
    const again = await bot().conversations.open({ users: ada })

    expect(dm.channel?.id).toMatch(/^D/)
    expect(again).toMatchObject({ already_open: true, channel: { id: dm.channel?.id } })
  })

  it("posts ephemerally to a member of the channel only", async () => {
    const random = await channelId("random")
    const grace = (await bot().users.lookupByEmail({ email: "grace@danwo.test" })).user?.id ?? ""
    const alan = (await bot().users.lookupByEmail({ email: "alan@danwo.test" })).user?.id ?? ""

    await bot().conversations.join({ channel: random })
    await bot().chat.postEphemeral({ channel: random, user: grace, text: "only you" })

    expect(
      slackWorkspace(emulator)
        .ephemeral("random", "grace")
        .map((m) => m.text),
    ).toEqual(["only you"])
    expect(
      (await slackError(bot().chat.postEphemeral({ channel: random, user: alan, text: "x" })))
        .error,
    ).toBe("user_not_in_channel")
  })

  it("posts a scheduled message once its time comes", async () => {
    const general = await channelId("general")
    const postAt = Math.floor(clock.clock().getTime() / 1000) + 60

    await bot().conversations.join({ channel: general })

    const scheduled = await bot().chat.scheduleMessage({
      channel: general,
      text: "Reminder",
      post_at: postAt,
    })

    expect(scheduled.scheduled_message_id).toMatch(/^Q/)
    expect(slackWorkspace(emulator).messages("general")).toHaveLength(0)
    clock.advance(61_000)
    expect(
      slackWorkspace(emulator)
        .messages("general")
        .map((m) => m.text),
    ).toEqual(["Reminder"])
    expect(
      (
        await slackError(
          bot().chat.scheduleMessage({ channel: general, text: "x", post_at: postAt - 3600 }),
        )
      ).error,
    ).toBe("time_in_past")
  })
})

describe("users", () => {
  it("lists members with emails and finds one by email", async () => {
    const { members = [] } = await bot().users.list({})
    const ada = members.find((m) => m.name === "ada")

    expect(ada).toMatchObject({
      real_name: "Ada Lovelace",
      is_admin: true,
      profile: { email: "ada@danwo.test" },
    })
    expect(members.some((m) => m.is_bot)).toBe(true)
    expect((await bot().users.info({ user: ada?.id ?? "" })).user?.name).toBe("ada")
    expect(
      (await slackError(bot().users.lookupByEmail({ email: "nobody@danwo.test" }))).error,
    ).toBe("users_not_found")
  })
})

describe("reactions", () => {
  it("adds, refuses a second time, and removes", async () => {
    const random = await channelId("random")

    await bot().conversations.join({ channel: random })

    const ts = slackWorkspace(emulator).post("grace", "random", "Shipped!")

    await bot().reactions.add({ channel: random, timestamp: ts, name: "tada" })
    expect(slackWorkspace(emulator).messages("random")[0]?.reactions).toEqual([
      { name: "tada", users: [expect.stringMatching(/^U/)] },
    ])
    expect(
      (await slackError(bot().reactions.add({ channel: random, timestamp: ts, name: "tada" })))
        .error,
    ).toBe("already_reacted")
    await bot().reactions.remove({ channel: random, timestamp: ts, name: "tada" })
    expect(slackWorkspace(emulator).messages("random")[0]?.reactions).toEqual([])
  })
})

describe("faults", () => {
  it("rate-limits each method with its own wait and drops writes after Slack acted", () => {
    const post = slackOutboundFaults({ method: "POST", path: "/api/chat.postMessage?x=1" })
    const list = slackOutboundFaults({ method: "GET", path: "/api/conversations.list" })

    expect(post[0]).toMatchObject({ kind: "status", status: 429, headers: { "retry-after": "1" } })
    expect(JSON.parse(post[0] && "body" in post[0] ? post[0].body : "")).toEqual({
      ok: false,
      error: "ratelimited",
    })
    expect(post.some((fault) => fault.kind === "reset-after")).toBe(true)
    expect(list.some((fault) => fault.kind === "reset-after")).toBe(false)
    expect(list).toContainEqual(
      expect.objectContaining({ status: 200, body: expect.stringContaining("token_revoked") }),
    )
  })

  it("faults incoming webhooks and response URLs, and nothing else", () => {
    expect(slackOutboundFaults({ method: "POST", path: "/services/T/B/x" })[0]).toMatchObject({
      status: 429,
      body: "rate_limited",
    })
    expect(slackOutboundFaults({ method: "POST", path: "/oauth/v2/authorize" })).toEqual([])
  })
})

describe("files", () => {
  it("uploads through the official client's two-step upload and shares it in a channel", async () => {
    const general = await channelId("general")

    await bot().conversations.join({ channel: general })

    await bot().filesUploadV2({
      channel_id: general,
      filename: "report.txt",
      file: Buffer.from("all green"),
      initial_comment: "Nightly report",
    })

    const shared = slackWorkspace(emulator).messages("general")[0]
    const fileId = shared?.files[0]?.id ?? ""

    expect(shared).toMatchObject({ text: "Nightly report", files: [{ name: "report.txt" }] })
    expect(slackWorkspace(emulator).file(fileId)?.toString()).toBe("all green")
  })
})

describe("seeded app ids", () => {
  it("derives the same app id on every seed when the seed names none", () => {
    const idOf = () => {
      const emulator = createEmulator(slack)

      seedSlack(emulator.store, {
        apps: [{ name: "Bot", client_id: "1.2", client_secret: "s", signing_secret: "x" }],
      })

      return slackStore(emulator.store).apps.all()[0]?.appId
    }

    expect(idOf()).toMatch(/^A[0-9A-Z]{10}$/)
    expect(idOf()).toBe(idOf())
  })
})
