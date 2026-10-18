/**
 * Vision: steps on what only an image shows. A canvas's buttons, an icon button with no name and a
 * card form in another origin's frame are acted on, recorded, and replayed with no model call; a
 * place drawn elsewhere is found by its look, a changed picture stops a strict replay, and stored
 * patches never show a secret field.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { crop, decodeGray } from "../src/vision/image.ts"
import { call, type Move, ref, scripted } from "./fixtures/scripted.ts"
import { BUY, onPage, SELL, startVisionSite, type VisionSite } from "./fixtures/vision-site.ts"

let site: VisionSite
let dir: string

beforeAll(async () => {
  site = await startVisionSite()
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-vision-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function withSession<T>(
  options: { path: string; mode?: "read-write" | "read-only" } & Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const { path, mode = "read-write", ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    assertionTimeout: 3_000,
    cache: { dir, mode, journey: "vision" },
    secrets: { password: { value: "hunter2-hunter2", purpose: "password" } },
    ...rest,
  })

  try {
    await session.app.open(path)

    return await run(session)
  } finally {
    await session.close()
  }
}

const status = (session: WebSession) => session.screen.getByTestId("status")

const BUY_AT: Move = () => ["click_at", { ...onPage(BUY), description: "the green BUY button" }]

/** Buys on the canvas and checks it bought, which confirms the step's recording. */
async function buy(session: WebSession) {
  const result = await session.agent.act("buy")

  await session.expect(status(session)).toHaveText("Bought")

  return result
}

/** The number of the mark over the star button, from the marks the latest look listed. */
function starMark(conversation: string): number {
  return Number(/(\d+): button\s+at 100,120/.exec(conversation)?.[1])
}

/** Stars the message and checks it is starred, which confirms the step's recording. */
async function star(session: WebSession) {
  await session.agent.act("star the message")
  await session.expect(status(session)).toHaveText("Starred")
}

/** Pays in the card frame and checks the page heard of it, which confirms the step's recording. */
async function pay(session: WebSession) {
  await session.agent.act("pay with card 4242424242424242")
  await session.expect(status(session)).toHaveText("Paid with card ending 4242")
}

function actStep(session: WebSession) {
  return session.flight.steps().find((entry) => entry.api === "agent.act")
}

/** Every recording file of the cache, parsed. */
async function recordings(): Promise<unknown[]> {
  const files = await readdir(dir)

  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8"))))
}

const Recorded = z.object({
  actions: z.array(
    z.object({
      kind: z.string(),
      visual: z
        .object({ patch: z.string(), point: z.object({ x: z.number(), y: z.number() }) })
        .optional(),
      target: z.object({ frame: z.array(z.string()).optional() }).optional(),
    }),
  ),
})

describe("vision", () => {
  it("tells the agent what the text view misses, clicks a canvas button and replays it", async () => {
    const actor = scripted([BUY_AT])

    await withSession({ path: "/canvas", model: actor }, buy)
    expect(actor.views[0]).toMatch(/Not in the text above: 1 canvas/)

    const idle = scripted([])
    const replayed = await withSession(
      { path: "/canvas", model: idle, mode: "read-only" },
      async (session) => ({
        result: await buy(session),
        step: actStep(session),
      }),
    )

    expect(replayed.result.modelCalls).toBe(0)
    expect(idle.doGenerateCalls).toHaveLength(0)
    expect(replayed.step?.cache?.mode).toBe("replayed")
  }, 60_000)

  it("finds a canvas button drawn elsewhere by its look and updates the recording", async () => {
    await withSession({ path: "/canvas", model: scripted([BUY_AT]) }, buy)

    const idle = scripted([])
    const moved = await withSession({ path: "/canvas?moved", model: idle }, async (session) => ({
      result: await buy(session),
      step: actStep(session),
    }))

    expect(moved.result.modelCalls).toBe(0)
    expect(moved.step?.cache?.mode).toBe("relocated")
    expect(moved.step?.events).toContainEqual(expect.objectContaining({ kind: "relocated" }))

    /* The recording follows the move, so a strict replay of the moved page now matches exactly. */
    const exact = await withSession(
      { path: "/canvas?moved", model: scripted([]), replay: { mode: "strict-stop" } },
      async (session) => {
        await buy(session)

        return actStep(session)
      },
    )

    expect(exact?.cache?.mode).toBe("replayed")
  }, 60_000)

  it("stops a strict replay when the picture at the recorded place changed", async () => {
    await withSession({ path: "/canvas", model: scripted([BUY_AT]) }, buy)

    const idle = scripted([])

    await withSession(
      { path: "/canvas?changed", model: idle, replay: { mode: "strict-stop" } },
      async (session) => {
        await session.agent.act("buy")
        expect(session.divergence()?.reason).toMatch(/does not look the same where it was/)
      },
    )
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("does not mistake a different button for a moved one", async () => {
    await withSession({ path: "/canvas", model: scripted([BUY_AT]) }, buy)

    const actor = scripted([
      () => ["click_at", { ...onPage(SELL), description: "the red SELL button" }],
    ])

    await withSession({ path: "/canvas?changed", model: actor }, async (session) => {
      await session.agent.act("buy")
    })
    expect(actor.doGenerateCalls.length).toBeGreaterThan(0)
  }, 60_000)

  it("looks, clicks an icon button with no name by its mark, and replays it", async () => {
    const actor = scripted([
      () => ["look", {}],
      (_view, conversation) => [
        "click_at",
        { mark: starMark(conversation), description: "the star button" },
      ],
    ])

    await withSession({ path: "/icons", model: actor }, star)
    expect(actor.prompts.at(-1)).toMatch(/numbered marks/)

    const idle = scripted([])

    await withSession({ path: "/icons", model: idle, mode: "read-only" }, star)
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("places a target from its description alone with the vision model", async () => {
    const grounder = new MockLanguageModelV4({
      provider: "mock",
      modelId: "grounder",
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"mark": 1}' }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    })
    const actor = scripted([() => ["click_at", { description: "the yellow star button" }]])

    await withSession(
      { path: "/icons", model: actor, vision: { model: grounder } },
      async (session) => {
        await session.agent.act("star the message")
        await session.expect(status(session)).toHaveText("Starred")
      },
    )
    expect(grounder.doGenerateCalls).toHaveLength(1)
  }, 60_000)

  it("acts in another origin's frame through the text view and replays it by frame", async () => {
    const actor = scripted([
      (view) => ["fill", { ref: ref(view, "textbox", "Card number"), text: "4242424242424242" }],
      (view) => ["click", { ref: ref(view, "button", "Pay") }],
    ])

    await withSession({ path: "/card", model: actor, vision: "off" }, pay)

    const [recorded] = await recordings()
    const actions = Recorded.parse(recorded).actions

    expect(actions.map((action) => action.target?.frame)).toEqual([
      ['iframe[title="Card"]'],
      ['iframe[title="Card"]'],
    ])

    const idle = scripted([])

    await withSession({ path: "/card", model: idle, mode: "read-only" }, pay)
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("never stores a patch that shows a secret field", async () => {
    const field = { x: 220, y: 222 }
    const actor = scripted([
      (view) => ["fill_secret", { ref: ref(view, "textbox", "Password"), secret: "password" }],
      () => ["click_at", { ...field, description: "the password field" }],
    ])

    await withSession({ path: "/secret", model: actor }, async (session) => {
      await session.agent.act("enter the password and click into the field")
      await session.expect(session.screen.getByLabel("Password")).toBeVisible()
    })

    const step = (await recordings()).map((entry) => Recorded.safeParse(entry).data).find(Boolean)
    const visual = step?.actions.find((action) => action.kind === "click_at")?.visual

    expect(visual).toBeDefined()

    const patch = decodeGray(Buffer.from(visual?.patch ?? "", "base64"))
    const inside = crop(patch, { x: 8, y: 16, width: 32, height: 12 })
    const values = new Set(Array.from(inside.pixels, (value) => Math.round(value)))

    /* The field is painted over in one flat colour: none of the dots the secret would draw. */
    expect(values.size).toBe(1)
  }, 60_000)

  it("reads a value only the canvas shows off the screenshot, checked by the schema", async () => {
    const extractor = scripted([
      () => [
        "read_screen",
        { fields: [{ path: "orders", value: 42, where: "bottom left of the board" }] },
      ],
    ])
    const value = await withSession({ path: "/canvas", model: extractor }, (session) =>
      session.agent.extract("the number of open orders", z.object({ orders: z.number() })),
    )

    expect(value).toEqual({ orders: 42 })
    expect(extractor.prompts[0]).toMatch(/read_screen|Screenshot of the viewport/)
  }, 60_000)

  it("shows a screenshot with every view when a step asks for vision, and none when it turns it off", async () => {
    const images: number[] = []
    const actor = new MockLanguageModelV4({
      provider: "mock",
      modelId: "watcher",
      doGenerate: async (options: LanguageModelV4CallOptions) => {
        const turn = options.prompt.filter((message) => message.role === "tool").length
        const files = options.prompt.flatMap((message) =>
          message.role === "user" ? message.content.filter((part) => part.type === "file") : [],
        )

        images.push(files.length)

        return turn === 0
          ? call("click_at", { ...onPage(BUY), description: "the green BUY button" })
          : call("done", { status: "passed", summary: "bought" })
      },
    })

    await withSession({ path: "/canvas", model: actor, mode: "read-only" }, async (session) => {
      await session.agent.act("buy", { vision: true })
      await session.agent.act("buy again", { vision: false })
    })
    /* Two turns with vision, a screenshot more each turn; one turn of text only. */
    expect(images.slice(0, 2)).toEqual([1, 2])
    expect(images.slice(2).every((count) => count === 0)).toBe(true)
    expect(images.length).toBeGreaterThan(2)
  }, 60_000)

  it("shows the judge a screenshot when the page has a canvas, unless vision is off", async () => {
    const seen: boolean[] = []
    const judge = new MockLanguageModelV4({
      provider: "mock",
      modelId: "judge",
      doGenerate: async (options: LanguageModelV4CallOptions) => {
        const image = options.prompt.some(
          (message) =>
            message.role === "user" && message.content.some((part) => part.type === "file"),
        )

        seen.push(image)

        return {
          ...call("unused", {}),
          content: [{ type: "text", text: JSON.stringify({ verdict: "holds", reason: "shown" }) }],
          finishReason: { unified: "stop", raw: undefined },
        }
      },
    })

    await withSession({ path: "/canvas", model: judge }, async (session) => {
      await session.agent.assert("the board shows a BUY button")
      await session.agent.assert("the board shows a BUY button", { vision: false })
    })
    expect(seen).toEqual([true, false])
  }, 60_000)
})
