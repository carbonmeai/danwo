import { once } from "node:events"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"

import { App, LogLevel } from "@slack/bolt"
import type { ViewsOpenArguments } from "@slack/web-api"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { listeningPort } from "../src/net.ts"
import { seedSlack, slack, slackSignature, slackWorkspace } from "../src/slack/index.ts"
import { ManualClock } from "../src/time.ts"
import { APP, BOT_TOKEN, clientFor, postMessage, WORKSPACE } from "./slack-workspace.ts"

async function freePort(): Promise<number> {
  const server = createServer()

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const port = listeningPort(server)

  server.close()

  return port
}

/** Waits until `check` passes, for up to five seconds. */
async function eventually(check: () => void): Promise<void> {
  const giveUpAt = Date.now() + 5_000

  for (;;) {
    try {
      check()

      return
    } catch (error) {
      if (Date.now() > giveUpAt) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

const MODAL = {
  type: "modal",
  callback_id: "feedback",
  title: { type: "plain_text", text: "Feedback" },
  submit: { type: "plain_text", text: "Send" },
  blocks: [
    {
      type: "input",
      block_id: "note",
      label: { type: "plain_text", text: "Note" },
      element: { type: "plain_text_input", action_id: "text" },
    },
  ],
} satisfies ViewsOpenArguments["view"]

describe("events, commands and interactions to a Bolt app", () => {
  let emulator: Emulator
  let bolt: App
  let botUserId: string
  const seen = {
    mentions: [] as string[],
    reactions: [] as string[],
    submitted: [] as unknown[],
  }

  beforeAll(async () => {
    const port = await freePort()
    const url = `http://127.0.0.1:${port}/slack/events`

    emulator = createEmulator(slack)
    seedSlack(emulator.store, {
      ...WORKSPACE,
      apps: [
        {
          ...APP,
          events: { url, bot_events: ["app_mention", "reaction_added", "message.channels"] },
          interactivity_url: url,
          commands: [{ command: "/standup", url }],
        },
      ],
      installations: [
        { app: APP.client_id, installer: "ada", bot_token: BOT_TOKEN, channels: ["general"] },
      ],
    })
    bolt = new App({
      token: BOT_TOKEN,
      signingSecret: APP.signing_secret,
      clientOptions: { fetch: (input, init) => emulator.fetch(new Request(input, init)) },
      logLevel: LogLevel.ERROR,
    })
    bolt.event("app_mention", async ({ event, say }) => {
      seen.mentions.push(event.text)
      await say({ text: `On it, <@${event.user ?? ""}>`, thread_ts: event.ts })
    })
    bolt.event("reaction_added", ({ event }) => {
      seen.reactions.push(event.reaction)

      return Promise.resolve()
    })
    bolt.command("/standup", async ({ ack, respond, command }) => {
      await ack()
      await respond({ text: `Standup started by <@${command.user_id}>` })
    })
    bolt.action("approve", async ({ ack, body, client }) => {
      await ack()
      if ("trigger_id" in body)
        await client.views.open({ trigger_id: body.trigger_id, view: MODAL })
    })
    bolt.view("feedback", async ({ ack, view }) => {
      await ack()
      seen.submitted.push(view.state.values)
    })
    await bolt.start(port)
    botUserId = (await clientFor(emulator, BOT_TOKEN).auth.test()).user_id ?? ""
  })

  afterAll(async () => {
    await bolt.stop()
    await emulator.close()
  })

  it("answers the url_verification challenge", async () => {
    expect(await slackWorkspace(emulator).verifyEventsUrl(APP.app_id)).toEqual({
      ok: true,
      status: 200,
    })
  })

  it("delivers a signed app_mention, and the app replies in the thread", async () => {
    const workspace = slackWorkspace(emulator)
    const ts = workspace.post("grace", "general", `<@${botUserId}> standup?`)

    await eventually(() => expect(workspace.thread("general", ts)).toHaveLength(2))
    expect(seen.mentions).toEqual([`<@${botUserId}> standup?`])
    expect(workspace.thread("general", ts)[1]).toMatchObject({
      text: expect.stringMatching(/^On it, <@U/),
      botId: expect.stringMatching(/^B/),
    })
  })

  it("delivers reaction_added", async () => {
    const workspace = slackWorkspace(emulator)
    const ts = workspace.post("ada", "general", "Release notes are up")

    workspace.react("grace", "general", ts, "eyes")
    await eventually(() => expect(seen.reactions).toEqual(["eyes"]))
  })

  it("runs a slash command and shows the app's response_url answer to the member only", async () => {
    const workspace = slackWorkspace(emulator)

    workspace.command("ada", "general", "/standup", "today")
    await eventually(() =>
      expect(workspace.ephemeral("general", "ada").map((m) => m.text)).toEqual([
        expect.stringMatching(/^Standup started by <@U/),
      ]),
    )
  })

  it("delivers a button click whose trigger opens a modal, then the modal's submission", async () => {
    const workspace = slackWorkspace(emulator)
    const posted = await postMessage(clientFor(emulator, BOT_TOKEN), {
      channel:
        (await clientFor(emulator, BOT_TOKEN).conversations.list({})).channels?.find(
          (c) => c.name === "general",
        )?.id ?? "",
      text: "Approve the release?",
      blocks: [
        {
          type: "actions",
          elements: [
            { type: "button", action_id: "approve", text: { type: "plain_text", text: "Approve" } },
          ],
        },
      ],
    })

    workspace.click("ada", "general", posted.ts ?? "", { actionId: "approve", value: "v2" })
    await eventually(() => expect(workspace.views("ada")).toHaveLength(1))

    const view = workspace.views("ada")[0]

    expect(view).toMatchObject({ type: "modal", callback_id: "feedback" })

    const values = { note: { text: { type: "plain_text_input", value: "Looks good" } } }

    workspace.submit("ada", String(view?.id), values)
    await eventually(() => expect(seen.submitted).toEqual([values]))
  })

  it("lets the app refuse a forged copy and still gets the real event once", async () => {
    const workspace = slackWorkspace(emulator)
    const before = seen.mentions.length

    emulator.webhooks?.setFault((message) =>
      message.topic.startsWith("events:") ? { kind: "forged" } : undefined,
    )

    try {
      workspace.post("alan", "general", `<@${botUserId}> ping`)
      await eventually(() => expect(seen.mentions).toHaveLength(before + 1))
      await emulator.webhooks?.idle()

      const statuses = (emulator.webhooks?.attempts() ?? []).slice(-2).map((a) => a.status)

      expect(statuses.toSorted((a, b) => (a ?? 0) - (b ?? 0))).toEqual([200, 401])
    } finally {
      emulator.webhooks?.setFault(undefined)
    }
  })
})

describe("retries", () => {
  let server: Server
  const received: { headers: IncomingHttpHeaders; body: string }[] = []
  let url = ""

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ""

      req.on("data", (chunk: Buffer) => (body += chunk.toString()))
      req.on("end", () => {
        received.push({ headers: req.headers, body })
        res.statusCode = received.length === 1 ? 500 : 200
        res.end()
      })
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    url = `http://127.0.0.1:${listeningPort(server)}/events`
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    received.length = 0
  })

  it("retries a failed event with X-Slack-Retry-Num and a fresh signature", async () => {
    const clock = new ManualClock(new Date())
    const emulator = createEmulator(slack, { clock: clock.clock, timer: clock.timer })

    seedSlack(emulator.store, {
      ...WORKSPACE,
      apps: [{ ...APP, events: { url, bot_events: ["message.channels"] } }],
      installations: [{ app: APP.client_id, bot_token: BOT_TOKEN, channels: ["random"] }],
    })
    slackWorkspace(emulator).post("ada", "random", "hello")
    clock.advance(0)
    await emulator.webhooks?.idle()
    clock.advance(1_000)
    await emulator.webhooks?.idle()
    await emulator.close()

    const [first, retry] = received

    expect(received).toHaveLength(2)
    expect(first?.headers["x-slack-retry-num"]).toBeUndefined()
    expect(retry?.headers).toMatchObject({
      "x-slack-retry-num": "1",
      "x-slack-retry-reason": "http_error",
    })
    expect(retry?.body).toBe(first?.body)

    const timestamp = Number(retry?.headers["x-slack-request-timestamp"])

    expect(retry?.headers["x-slack-signature"]).toBe(
      slackSignature(APP.signing_secret, timestamp, retry?.body ?? ""),
    )
  })
})
