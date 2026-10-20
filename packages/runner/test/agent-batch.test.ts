/**
 * How agent steps report what they did with the cache and the model, and the rails around them:
 * cache outcomes (missed, replayed, stale with what changed, handed off), the loop guard and
 * budgets in a live step, the judge's four verdicts on a page it sees alone, and secrets that only
 * go into fields their purpose allows.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { type JudgeInput, judgeMessage } from "../src/agent/judge.ts"
import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { cacheLine, usageOf } from "../src/record/usage.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"
import { type Move, ref, scripted, text } from "./fixtures/scripted.ts"

/** The desk; `?renamed` calls its save button "Keep", so a recording that clicks "Save" no longer replays. */
const page = (renamed: boolean) => `<!doctype html><title>Desk</title><h1>Desk</h1>
<button type="button" onclick="document.querySelector('p').textContent = 'Saved'">${renamed ? "Keep" : "Save"}</button>
<button type="button">Nothing</button>
<label>Password <input type="password" name="password"></label>
<label>Code <input name="code" autocomplete="one-time-code"></label>
<label>Note <input name="note"></label>
<p data-testid="status">Idle</p>`

const SAVE: Move = (view) => ["click", { ref: ref(view, "button", "Save") }]
const NOTHING: Move = (view) => ["click", { ref: ref(view, "button", "Nothing") }]

let site: HtmlServer
let dir: string

beforeAll(async () => {
  site = await serveHtml((url) =>
    url.pathname === "/" ? page(url.searchParams.has("renamed")) : undefined,
  )
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-batch-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Opens the desk with `options`; a cache in the test's folder unless `noCache`. */
async function withSession<T>(
  options: Partial<WebSessionOptions> & { readonly noCache?: boolean },
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const { noCache, ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    assertionTimeout: 2_000,
    ...(noCache ? {} : { cache: { dir, mode: "read-write", journey: "desk" } }),
    ...rest,
  })

  try {
    await session.app.open("/")

    return await run(session)
  } finally {
    await session.close()
  }
}

/** Runs `instruction`, confirms it with a check, and returns the step's cache note. */
async function saveStep(session: WebSession, instruction = "save the desk") {
  await session.agent.act(instruction)
  await session.expect(session.screen.getByTestId("status")).toHaveText("Saved")

  return session.flight.steps().find((step) => step.api === "agent.act")?.cache
}

describe("cache outcomes", () => {
  it("misses, records, replays, and names what changed when a recording is stale", async () => {
    const first = await withSession({ model: scripted([SAVE]) }, saveStep)

    expect(first).toEqual({ mode: "missed", saved: true })

    const replayed = await withSession({ model: scripted([]) }, async (session) => {
      const cache = await saveStep(session)

      return { cache, line: cacheLine(usageOf(session.flight.steps()).cache) }
    })

    expect(replayed.cache).toEqual({ mode: "replayed" })
    expect(replayed.line).toBe("cache: 1 replayed · 0 relocated · 0 handed off · 0 missed")

    const strict = await withSession(
      { model: scripted([]), replay: { mode: "strict-stop" } },
      async (session) => {
        const error = await session.agent.act("save the desk now").catch((e: unknown) => e)

        return { error, cache: session.flight.steps()[1]?.cache }
      },
    )

    expect(strict.error).toMatchObject({ code: "STALE_RECORDING" })
    expect(strict.cache).toEqual({ mode: "stale", changed: ["instruction"] })

    const relearned = await withSession({ model: scripted([SAVE]) }, (session) =>
      saveStep(session, "save the desk now"),
    )

    expect(relearned).toEqual({ mode: "stale", changed: ["instruction"], saved: true })
  }, 90_000)

  it("hands a step to the model when its recording no longer replays", async () => {
    await withSession({ model: scripted([SAVE]) }, saveStep)

    const actor = scripted([(view) => ["click", { ref: ref(view, "button", "Keep") }]])
    const cache = await withSession({ model: actor, relocation: "exact" }, async (session) => {
      await session.app.open("/?renamed")

      return saveStep(session)
    })

    expect(cache).toEqual({ mode: "stale", changed: ["policy"], saved: true })

    const handed = scripted([(view) => ["click", { ref: ref(view, "button", "Keep") }]])
    const handedCache = await withSession({ model: handed }, async (session) => {
      await session.app.open("/?renamed")

      return saveStep(session)
    })

    expect(handedCache).toEqual({
      mode: "handed-off",
      reason: 'action 1 (click): getByRole("button", name: "Save") is no longer on the page',
      saved: true,
    })
    expect(actor.doGenerateCalls.length).toBeGreaterThan(0)
  }, 90_000)
})

describe("loop guard and budgets in a live step", () => {
  it("warns the model once when it keeps doing the same thing, then stops the step", async () => {
    const actor = scripted([NOTHING, NOTHING, NOTHING, NOTHING, NOTHING, NOTHING, NOTHING])

    await withSession({ model: actor, noCache: true }, async (session) => {
      await expect(session.agent.act("save the desk")).rejects.toMatchObject({
        code: "AGENT_LOOPING",
      })
    })

    expect(actor.prompts.some((prompt) => prompt.includes("Warning: You have made"))).toBe(true)
  }, 60_000)

  it("stops a step that runs past its budget", async () => {
    await withSession({ model: scripted([NOTHING, SAVE]), noCache: true }, async (session) => {
      await expect(
        session.agent.act("save the desk", { budget: { modelCalls: 1 } }),
      ).rejects.toMatchObject({
        code: "BUDGET_EXCEEDED",
        message: expect.stringMatching(/used up its budget of 1 model calls/),
      })
    })
  }, 60_000)
})

/** A judge that answers `verdict`, keeping every prompt it was given. */
function judgeSaying(verdict: string) {
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "judge",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      prompts.push(text(options.prompt))

      return {
        content: [{ type: "text", text: JSON.stringify({ verdict, reason: "the page says so" }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }
    },
  })

  return Object.assign(model, { prompts })
}

describe("the judge", () => {
  it("sees only the claim, the page and the app's words", async () => {
    const judge = judgeSaying("holds")

    await withSession(
      { model: scripted([SAVE]), judge, agentContext: "a desk app", noCache: true },
      async (session) => {
        await session.agent.act("save the desk with the secret plan")
        await session.agent.assert("the desk was saved")
      },
    )

    expect(judge.prompts).toHaveLength(1)
    expect(judge.prompts[0]).toContain("Claim: the desk was saved")
    expect(judge.prompts[0]).toContain("About this app: a desk app")
    expect(judge.prompts[0]).not.toContain("secret plan")
    expect(judge.prompts[0]).not.toContain("Instruction:")

    const input: JudgeInput = { claim: "c", screen: { text: "page" } }

    // @ts-expect-error the judge's input has no room for the actor's transcript
    const widened: JudgeInput = { ...input, transcript: ["earlier steps"] }

    expect(JSON.stringify(judgeMessage(widened))).not.toContain("earlier steps")
  }, 60_000)

  it("reports blocked and inconclusive claims as such, not as failures", async () => {
    for (const [verdict, code, status] of [
      ["blocked", "CLAIM_BLOCKED", "blocked"],
      ["inconclusive", "CLAIM_INCONCLUSIVE", "inconclusive"],
      ["fails", "CLAIM_FAILED", "failed"],
    ] as const) {
      const step = await withSession(
        { judge: judgeSaying(verdict), noCache: true },
        async (session) => {
          await session.agent.assert("the desk was saved").catch(() => undefined)

          return session.flight.steps().find((s) => s.api === "agent.assert")
        },
      )

      expect(step).toMatchObject({ status, error: { code } })
    }
  }, 60_000)
})

describe("secrets and the fields they go into", () => {
  const secrets = {
    password: { value: "pw-batch-0451", purpose: "password" as const },
    code: { value: "776-112", purpose: "otp" as const },
    token: "tok-batch-91x2",
    anywhere: { value: "any-batch-55", fields: "any" as const },
  }

  it("types each secret only where its purpose allows", async () => {
    await withSession({ secrets, noCache: true }, async (session) => {
      const { screen } = session

      await screen.getByLabel("Password").fill(session.secret("password"))
      await screen.getByLabel("Code").fill(session.secret("code"))
      await screen.getByLabel("Note").fill(session.secret("token"))
      await screen.getByLabel("Password").fill(session.secret("anywhere"))

      await expect(
        screen.getByLabel("Note").fill(session.secret("password")),
      ).rejects.toMatchObject({
        code: "SECRET_REFUSED",
        message: expect.stringMatching(/into a text field/),
      })
      await expect(
        screen.getByLabel("Password").fill(session.secret("token")),
      ).rejects.toMatchObject({ code: "SECRET_REFUSED" })
      await expect(
        screen.getByLabel("Password").fill(session.secret("code")),
      ).rejects.toMatchObject({ code: "SECRET_REFUSED" })
    })
  }, 60_000)

  it("tells the model when it picked the wrong field for a secret", async () => {
    const actor = scripted([
      (view) => ["fill_secret", { ref: ref(view, "textbox", "Note"), secret: "password" }],
      (view) => ["fill_secret", { ref: ref(view, "textbox", "Password"), secret: "password" }],
    ])

    await withSession({ model: actor, secrets, noCache: true }, async (session) => {
      await session.agent.act("sign in with {password}", {
        params: { password: session.secret("password") },
      })
    })

    expect(
      actor.prompts.some((prompt) => /failed: refused to type secret "password"/.test(prompt)),
    ).toBe(true)
  }, 60_000)
})
