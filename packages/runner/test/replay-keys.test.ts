/**
 * What a recording is kept under and what it holds: a route built from a `unique()` value replays
 * on a run with a fresh one, the same instruction twice in a test is two recordings, each
 * recording names the model that made it, and a replay-only session calls no model at all.
 */
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MockLanguageModelV4 } from "ai/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { modelName } from "../src/model/resolve.ts"
import { addUsage, cacheLine } from "../src/record/usage.ts"
import { unique } from "../src/replay/params.ts"
import { routeMatches, templateRoute } from "../src/replay/route.ts"
import { ReplayStore } from "../src/replay/store.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"
import { judging, verdict } from "./fixtures/judging.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"

const NOTHING = { calls: 0, retries: 0, tokens: [0, 0], usd: 0 } as const

/** A page that creates a company and moves to its page, its name in the path. */
const PAGE = `<!doctype html><title>Companies</title><h1>Companies</h1>
<label>Company name <input name="company"></label>
<button type="button" id="create">Create</button>
<script>
document.getElementById("create").addEventListener("click", () => {
  const name = document.querySelector("input").value
  history.pushState({}, "", "/companies/" + encodeURIComponent(name))
  document.querySelector("h1").textContent = "Company " + name
})
</script>`

/** Whether the wizard shows its Continue button; tests take it away to change the page. */
const wizard = { button: true }

/** A wizard whose Continue button moves to the next step, each at its own path. */
const wizardPage = () => `<!doctype html><title>Wizard</title><h1>Step 1</h1>
<button type="button" id="next"${wizard.button ? "" : " hidden"}>Continue</button>
<script>
let at = 1
document.getElementById("next").addEventListener("click", () => {
  at += 1
  history.pushState({}, "", "/wizard/" + ["", "", "details", "review"][at])
  document.querySelector("h1").textContent = "Step " + at
})
</script>`

const CONTINUE: readonly Move[] = [(view) => ["click", { ref: ref(view, "button", "Continue") }]]

const CREATE: readonly Move[] = [
  (view, conversation) => {
    const name = /"company":\s*"([^"]+)"/.exec(conversation)?.[1] ?? ""

    return ["fill", { ref: ref(view, "textbox", "Company name"), text: name }]
  },
  (view) => ["click", { ref: ref(view, "button", "Create") }],
]

let site: HtmlServer
let dir: string

beforeAll(async () => {
  site = await serveHtml((url) => {
    if (url.pathname === "/") return PAGE
    if (url.pathname.startsWith("/wizard")) return wizardPage()

    return undefined
  })
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-keys-"))
  wizard.button = true
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** One session with a cache in the test's folder, on the page. */
async function withSession<T>(
  options: Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<T>,
  path = "/",
): Promise<T> {
  const session = await openWebSession({
    baseUrl: site.url,
    assertionTimeout: 2_000,
    cache: { dir, mode: "read-write", journey: "keys" },
    ...options,
  })

  try {
    await session.app.open(path)

    return await run(session)
  } finally {
    await session.close()
  }
}

/** The recordings in the cache folder, parsed. */
async function recordings(): Promise<Record<string, unknown>[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"))

  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8"))))
}

/** Creates the company `name`, a `unique()` value, and checks its page; the step's cache note. */
async function createCompany(options: Partial<WebSessionOptions>, name: string) {
  return withSession(options, async (session) => {
    await session.agent.act("create the company {company}", {
      params: { company: unique(name) },
    })
    await session.expect(session.screen.getByRole("heading")).toHaveText(`Company ${name}`)

    return session.flight.steps().find((step) => step.api === "agent.act")?.cache
  })
}

describe("a unique() value in the route", () => {
  it("is a placeholder in the recorded end route, so a run with a fresh value replays", async () => {
    await createCompany({ model: scripted(CREATE) }, "E2E mu62l6pb9u1v")

    const [recorded] = await recordings()

    expect(recorded).toMatchObject({ endRoute: "app/companies/{company}" })

    const idle = scripted([])
    const cache = await createCompany({ model: idle }, "E2E zq81k0ab3c4d")

    expect(cache).toEqual({ mode: "replayed" })
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("matches the value as typed, percent-encoded, form-encoded or as a slug", () => {
    const values = { name: "Acme k3j9x2" }

    expect(templateRoute("app/companies/Acme%20k3j9x2/edit", values)).toBe(
      "app/companies/{name}/edit",
    )
    expect(templateRoute("app/search/Acme+k3j9x2", values)).toBe("app/search/{name}")
    expect(templateRoute("app/c/acme-k3j9x2", values)).toBe("app/c/{name}")
    expect(templateRoute("acme.test/c/acme-k3j9x2", values)).toBe("acme.test/c/{name}")

    const fresh = { name: "Acme p0q1r2" }

    expect(
      routeMatches("app/companies/Acme%20p0q1r2/edit", "app/companies/{name}/edit", fresh),
    ).toBe(true)
    expect(routeMatches("app/c/acme-p0q1r2", "app/c/{name}", fresh)).toBe(true)
    expect(routeMatches("app/c/acme-k3j9x2", "app/c/{name}", fresh)).toBe(false)
    expect(routeMatches("app/c/acme-p0q1r2", "app/c/{other}", fresh)).toBe(false)
    expect(routeMatches("app/thanks", "app/thanks", fresh)).toBe(true)
  })
})

/** Continues twice through the wizard, checking each step; the agent steps' cache modes. */
async function continuedTwice(session: WebSession) {
  await session.agent.act("click Continue")
  await session.expect(session.screen.getByRole("heading")).toHaveText("Step 2")
  await session.agent.act("click Continue")
  await session.expect(session.screen.getByRole("heading")).toHaveText("Step 3")

  return session.flight
    .steps()
    .filter((step) => step.api === "agent.act")
    .map((step) => step.cache?.mode)
}

describe("the same instruction twice in a test", () => {
  it("is two recordings, each replayed by its own step", async () => {
    const recorded = await withSession({ model: scripted(CONTINUE) }, continuedTwice, "/wizard")

    expect(recorded).toEqual(["missed", "missed"])

    const kept = await recordings()
    const routes = kept.map((trace) => String(trace["endRoute"]))
    const occurrences = kept.map((trace) =>
      JSON.stringify(trace["identity"]).includes('"occurrence":1') ? 1 : 0,
    )

    expect(routes.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "app/wizard/details",
      "app/wizard/review",
    ])
    expect(occurrences.toSorted((a, b) => a - b)).toEqual([0, 1])

    const idle = scripted([])

    expect(await withSession({ model: idle }, continuedTwice, "/wizard")).toEqual([
      "replayed",
      "replayed",
    ])
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)
})

describe("step keys", () => {
  const options = { dir: "unused", mode: "read-write", projectId: "p", journey: "j" } as const
  const call = { kind: "act", instruction: "click Continue", params: {} } as const

  it("key the first occurrence as before, and later ones by how many came first", () => {
    const store = new ReplayStore({ ...options, appIdentity: "http://127.0.0.1" })
    const first = store.key({ ...call, step: 0 })
    const between = store.key({ ...call, step: 1, instruction: "click Back" })
    const second = store.key({ ...call, step: 2 })
    const { step: _step, ...keyed } = first.identity
    const before = createHash("sha256").update(JSON.stringify(keyed)).digest("hex").slice(0, 32)

    expect(first.key).toBe(before)
    expect(first.identity).not.toHaveProperty("occurrence")
    expect(second.identity).toMatchObject({ step: 2, occurrence: 1 })
    expect(new Set([first.key, between.key, second.key]).size).toBe(3)
    expect(store.key({ ...call, step: 0 }).key).toBe(first.key)
    expect(store.key({ ...call, step: 2 }).key).toBe(second.key)
  })
})

describe("the model in each recording", () => {
  it("is kept, and a replay on another model says so without calling it", async () => {
    await withSession({ model: scripted(CONTINUE) }, continuedTwice, "/wizard")

    const kept = await recordings()

    expect(kept.map((trace) => trace["recordedBy"])).toEqual([
      "mock/toolbox-actor",
      "mock/toolbox-actor",
    ])

    const other = new MockLanguageModelV4({ provider: "gateway", modelId: "anthropic/claude-x" })
    const notes = await withSession(
      { model: other },
      async (session) => {
        await continuedTwice(session)

        return session.flight.steps().flatMap((step) => (step.cache ? [step.cache] : []))
      },
      "/wizard",
    )
    const swapped = {
      mode: "replayed",
      recordedWith: "mock/toolbox-actor",
      runningWith: "anthropic/claude-x",
    }

    expect(notes).toEqual([swapped, swapped])
    expect(other.doGenerateCalls).toHaveLength(0)

    const same = await withSession({ model: scripted([]) }, continuedTwice, "/wizard")

    expect(same).toEqual(["replayed", "replayed"])
  }, 60_000)

  it("is named by its id, with the provider when the id has none", () => {
    expect(modelName("openai/gpt-5-mini")).toBe("openai/gpt-5-mini")
    expect(modelName(new MockLanguageModelV4({ provider: "openai.chat", modelId: "gpt-5" }))).toBe(
      "openai/gpt-5",
    )
    expect(modelName(undefined)).toBeUndefined()
  })

  it("ends the cache line with the steps another model recorded", () => {
    const models = [
      { recordedWith: "openai/gpt-5-mini", runningWith: "anthropic/claude-x", steps: 4 },
    ]
    const usage = addUsage([
      { cache: { replayed: 3 }, models, spent: NOTHING, steps: [] },
      { cache: { replayed: 1 }, models: [{ ...models[0]!, steps: 0 }], spent: NOTHING, steps: [] },
    ])

    expect(cacheLine(usage.cache, usage.recordings, usage.models)).toBe(
      "cache: 4 replayed · 0 relocated · 0 handed off · 0 missed · recorded with openai/gpt-5-mini (4 steps), running anthropic/claude-x",
    )
    expect(cacheLine({ replayed: 1 })).toBe(
      "cache: 1 replayed · 0 relocated · 0 handed off · 0 missed",
    )
  })
})

describe("replay-only", () => {
  const replayOnly = { replay: { mode: "replay-only" } } as const

  it("replays recorded steps, and fails one with no recording without calling the model", async () => {
    await withSession({ model: scripted(CONTINUE) }, continuedTwice, "/wizard")

    const actor = scripted(CONTINUE)
    const judge = scripted([])
    const outcome = await withSession(
      { ...replayOnly, model: actor, judge },
      async (session) => {
        const modes = await continuedTwice(session)
        const third = await session.agent.act("click Continue").catch((error: unknown) => error)
        const claim = await session.agent
          .assert("the wizard is on its review step")
          .catch((error: unknown) => error)

        return { modes, third, claim }
      },
      "/wizard",
    )

    expect(outcome.modes).toEqual(["replayed", "replayed"])
    expect(outcome.third).toMatchObject({
      code: "REPLAY_MISSING",
      message: expect.stringContaining(
        'agent.act("click Continue") has no recording that replays (none was recorded)',
      ),
    })
    expect(outcome.claim).toMatchObject({
      code: "REPLAY_MISSING",
      message: expect.stringContaining('agent.assert("the wizard is on its review step")'),
    })
    expect(actor.doGenerateCalls).toHaveLength(0)
    expect(judge.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("fails a step whose recording no longer replays, saying why", async () => {
    await withSession({ model: scripted(CONTINUE) }, continuedTwice, "/wizard")
    wizard.button = false

    const actor = scripted(CONTINUE)
    const failed = await withSession(
      { ...replayOnly, model: actor },
      (session) => session.agent.act("click Continue").catch((error: unknown) => error),
      "/wizard",
    )

    expect(failed).toMatchObject({
      code: "REPLAY_MISSING",
      message: expect.stringMatching(/no recording that replays \(it no longer replays: action 1/),
    })
    expect(actor.doGenerateCalls).toHaveLength(0)
  }, 60_000)
})

/** Asserts the wizard's first step, live; the judge's calls and the step's cache note. */
async function assertLive(options: Partial<WebSessionOptions> = {}) {
  const judge = judging([verdict("holds", "Step 1")])
  const outcome = await withSession(
    { judge, ...options },
    async (session) => {
      const error = await session.agent
        .assert("the wizard is on its first step", { replay: false })
        .catch((caught: unknown) => caught)

      return { error, cache: session.flight.steps().find((s) => s.api === "agent.assert")?.cache }
    },
    "/wizard",
  )

  return { ...outcome, calls: judge.doGenerateCalls.length }
}

describe("an assert that does not replay", () => {
  it("asks the judge on every run and keeps no recording", async () => {
    expect(await assertLive()).toEqual({ error: undefined, cache: { mode: "off" }, calls: 1 })
    expect(await assertLive()).toEqual({ error: undefined, cache: { mode: "off" }, calls: 1 })
    expect(await recordings()).toEqual([])
  }, 60_000)

  it("fails under replay-only without asking the judge", async () => {
    const run = await assertLive({ replay: { mode: "replay-only" } })

    expect(run.calls).toBe(0)
    expect(run.error).toMatchObject({
      code: "REPLAY_MISSING",
      message: expect.stringContaining("asks the judge on every run ({ replay: false })"),
    })
  }, 60_000)
})
