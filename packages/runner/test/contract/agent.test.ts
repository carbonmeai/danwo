/*
 * Contract: `agent.act` records a step once a later check confirms it and replays it with no
 * model calls; `unique()` values change on replay without a new recording; strict-stop replays
 * stop at the first step that no longer replays and say where; `agent.assert` asks a judge.
 * The scripted models (scripted-models.ts) are the only part that knows the agent's protocol.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModel } from "ai"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, unique, type WebSession, type WebSessionOptions } from "../../src/index.ts"
import { type ScriptedAction, scriptedActor, scriptedJudge } from "./scripted-models.ts"
import { type Site, startSite } from "./site.ts"

const ADD_ONE: readonly ScriptedAction[] = [{ click: { role: "button", name: "Add one" } }]
const GREET: readonly ScriptedAction[] = [
  { type: { role: "textbox", name: "Name" }, param: "name" },
  { click: { role: "button", name: "Greet" } },
]

type CacheMode = NonNullable<WebSessionOptions["cache"]>["mode"]

let site: Site
let dir: string

beforeAll(async () => {
  site = await startSite()
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-contract-cache-"))
  site.setCounterVariant("a")
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function withSession(
  options: {
    model?: LanguageModel
    mode?: CacheMode
    journey?: string
  } & Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<void>,
): Promise<void> {
  const { mode = "read-write", journey = "contract", ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    assertionTimeout: 2_000,
    cache: { dir, mode, journey },
    ...rest,
  })

  try {
    await run(session)
  } finally {
    await session.close()
  }
}

/** Adds one to the counter through the agent, then confirms it (which lets the step be saved). */
async function addOne(options: Parameters<typeof withSession>[0]): Promise<number> {
  let modelCalls = -1

  await withSession(options, async ({ app, agent, screen, expect: check }) => {
    await app.open("/counter")
    modelCalls = (await agent.act("add one to the counter")).modelCalls
    await check(screen.getByTestId("count")).toHaveText("1")
  })

  return modelCalls
}

/** Whether a strict-stop replay of "add one" finds a recording to replay. */
async function hasRecording(): Promise<boolean> {
  let recorded = true

  await withSession(
    { model: scriptedActor(ADD_ONE), mode: "read-only", replay: { mode: "strict-stop" } },
    async ({ app, agent }) => {
      await app.open("/counter")
      await agent.act("add one to the counter").catch((error: unknown) => {
        if (!/nothing recorded to replay/.test(String(error))) throw error
        recorded = false
      })
    },
  )

  return recorded
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

describe("recording and replay", () => {
  it("records a confirmed step, then replays it with no model calls", async () => {
    const recorder = scriptedActor(ADD_ONE)
    const replayer = scriptedActor(ADD_ONE)

    expect(await addOne({ model: recorder })).toBeGreaterThan(0)
    expect(await addOne({ model: replayer, mode: "read-only" })).toBe(0)
    expect(replayer.doGenerateCalls).toHaveLength(0)
  }, 120_000)

  it("does not keep a step that no later check confirmed", async () => {
    await withSession({ model: scriptedActor(ADD_ONE) }, async ({ app, agent }) => {
      await app.open("/counter")
      await agent.act("add one to the counter")
    })

    expect(await hasRecording()).toBe(false)
  }, 120_000)

  it("neither reads nor writes recordings with the cache off", async () => {
    const actor = scriptedActor(ADD_ONE)

    await addOne({ model: actor, mode: "off" })
    await addOne({ model: actor, mode: "off" })

    expect(actor.doGenerateCalls.length).toBeGreaterThanOrEqual(2)
    expect(await hasRecording()).toBe(false)
  }, 120_000)

  it("does not write recordings in read-only mode", async () => {
    const actor = scriptedActor(ADD_ONE)

    expect(await addOne({ model: actor, mode: "read-only" })).toBeGreaterThan(0)
    expect(await hasRecording()).toBe(false)
  }, 120_000)

  it("hands a step whose recording no longer replays back to the model outside strict-stop", async () => {
    await addOne({ model: scriptedActor(ADD_ONE) })
    site.setCounterVariant("b")

    const healer = scriptedActor([{ click: { role: "button", name: "Plus one" } }])

    expect(await addOne({ model: healer })).toBeGreaterThan(0)
  }, 120_000)
})

/** Greets `name` through the agent and returns how many model calls it took. */
async function greet(
  model: LanguageModel,
  name: string | ReturnType<typeof unique>,
  shown: string,
  mode: CacheMode = "read-write",
) {
  let modelCalls = -1

  await withSession({ model, mode, journey: "greet" }, async (session) => {
    await session.app.open("/greet")
    modelCalls = (await session.agent.act('greet "{name}"', { params: { name } })).modelCalls
    await session.expect(session.screen.getByTestId("greeting")).toHaveText(`Hello, ${shown}`)
  })

  return modelCalls
}

describe("params", () => {
  it("replays a unique() value with this run's value and no model calls", async () => {
    expect(await greet(scriptedActor(GREET), unique("ada-1"), "ada-1")).toBeGreaterThan(0)
    expect(await greet(scriptedActor(GREET), unique("bob-2"), "bob-2", "read-only")).toBe(0)
  }, 120_000)

  it("does not replay a recording made with a different plain param value", async () => {
    expect(await greet(scriptedActor(GREET), "cat", "cat")).toBeGreaterThan(0)
    expect(await greet(scriptedActor(GREET), "dog", "dog")).toBeGreaterThan(0)
  }, 120_000)
})

describe("strict-stop replay", () => {
  it("stops at the first step that no longer replays, says where, and acts no further", async () => {
    await addOne({ model: scriptedActor(ADD_ONE) })
    site.setCounterVariant("b")

    const actor = scriptedActor(ADD_ONE)

    await withSession(
      { model: actor, mode: "read-only", replay: { mode: "strict-stop" } },
      async (session) => {
        await session.app.open("/counter")
        expect(session.divergence()).toBeUndefined()
        await session.agent.act("add one to the counter")
        await session.agent.act("add one to the counter again")

        expect(session.divergence()).toMatchObject({
          step: 0,
          instruction: "add one to the counter",
        })
        expect(session.divergence()?.reason).toBeTruthy()
        expect(await session.screen.getByTestId("count").textContent()).toBe("0")
      },
    )

    expect(actor.doGenerateCalls).toHaveLength(0)
  }, 120_000)

  it("fails a step with nothing recorded instead of passing on nothing", async () => {
    const actor = scriptedActor(ADD_ONE)

    await withSession(
      { model: actor, mode: "read-only", replay: { mode: "strict-stop" } },
      async ({ app, agent }) => {
        await app.open("/counter")
        await expect(agent.act("add one to the counter")).rejects.toThrow(
          /nothing recorded to replay/,
        )
      },
    )

    expect(actor.doGenerateCalls).toHaveLength(0)
  }, 120_000)
})

describe("secrets in agent steps", () => {
  it("shows the model a secret's name, types its value, and never records the value", async () => {
    const value = "tok-agent-contract-93e1"
    const actor = scriptedActor([
      { typeSecret: { role: "textbox", name: "Token" }, secret: "token" },
      { click: { role: "button", name: "Submit" } },
    ])
    const steps: string[] = []

    await withSession({ model: actor, secrets: { token: value } }, async (session) => {
      await session.app.open("/login")
      await session.agent.act("submit the token {token}", {
        params: { token: session.secret("token") },
      })
      expect(await session.screen.getByLabel("Token").inputValue()).toBe(value)
      await session.expect(session.screen.getByText("Submitted")).toBeVisible()
      steps.push(JSON.stringify(session.flight.steps()))
    })

    expect(actor.prompts.length).toBeGreaterThan(0)
    expect(actor.prompts.some((prompt) => prompt.includes(value))).toBe(false)
    expect(steps.join("")).not.toContain(value)
    for (const file of await filesUnder(dir))
      expect(await readFile(file, "utf8")).not.toContain(value)
  }, 120_000)
})

describe("agent.assert and missing models", () => {
  it("passes when the judge says the claim holds and fails with its explanation when not", async () => {
    await withSession(
      { model: scriptedActor([]), judge: scriptedJudge("holds") },
      async ({ app, agent }) => {
        await app.open("/counter")
        await agent.assert("the counter shows 0")
      },
    )
    await withSession(
      { model: scriptedActor([]), judge: scriptedJudge("fails") },
      async ({ app, agent }) => {
        await app.open("/counter")
        await expect(agent.assert("the counter shows 9")).rejects.toThrow(/scripted: fails/)
      },
    )
  }, 120_000)

  it("refuses agent steps when the session has no model", async () => {
    await withSession({}, async ({ app, agent }) => {
      await app.open("/counter")
      await expect(agent.act("add one to the counter")).rejects.toThrow(/model/)
    })
  }, 60_000)
})
