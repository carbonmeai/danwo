import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession } from "../src/session.ts"
import { type ShopEnvironment, startShopEnvironment } from "./environment.ts"

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function toolCall(toolName: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${toolName}-${Math.random()}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  }
}

function text(value: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  }
}

/** Every string in the prompt (messages, tool results), joined: what the model would read. */
function promptText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(promptText).join("\n")
  if (value && typeof value === "object") return Object.values(value).map(promptText).join("\n")

  return ""
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * A scripted actor: on the first turn it finds the button named `buttonName` in the page view
 * (`- button "Buy 500 credits" [ref=e12]`) and clicks it; once a click result is in the
 * conversation it ends the step as passed.
 */
function scriptedActor(buttonName: string): MockLanguageModelV4 & { taps: number } {
  const button = new RegExp(
    `- button ${escapeRegExp(JSON.stringify(buttonName))}[^\\n]*?\\[ref=([a-z0-9]+)\\]`,
  )
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted-actor",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const prompt = promptText(options.prompt.filter((m) => m.role !== "system"))
      const clicked = options.prompt.some(
        (message) =>
          message.role === "tool" &&
          message.content.some((part) => "toolName" in part && part.toolName === "click"),
      )

      if (clicked) return toolCall("done", { status: "passed", summary: `clicked ${buttonName}` })

      const match = button.exec(prompt)

      if (!match?.[1]) throw new Error(`scripted actor: no button ${buttonName} in the page view`)
      actor.taps++

      return toolCall("click", { ref: match[1] })
    },
  })
  const actor = Object.assign(model, { taps: 0 })

  return actor
}

/** A scripted judge that always returns `verdict`. */
function scriptedJudge(verdict: "holds" | "fails"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: `judge-${verdict}`,
    doGenerate: async () => text({ verdict, reason: `scripted: ${verdict}` }),
  })
}

let env: ShopEnvironment

beforeAll(async () => {
  env = await startShopEnvironment()
}, 60_000)

afterAll(async () => {
  await env.close()
})

async function withCacheDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "danwo-cache-"))

  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

describe("agent.act with the replay cache", () => {
  it("records a verified step, then replays it with no model calls", async () => {
    await withCacheDir(async (dir) => {
      const cache = {
        dir,
        mode: "read-write" as const,
        journey: "buy credits",
        appIdentity: "shop",
      }

      const actor = scriptedActor("Buy 500 credits")
      const first = await openWebSession({
        baseUrl: env.shopUrl,
        proxy: env.proxy,
        model: actor,
        cache,
      })

      try {
        await first.app.open("/")
        await first.agent.act("buy 500 credits")
        await first.expect(first.screen.getByTestId("checkout-total")).toContainText("$5.00")
      } finally {
        await first.close()
      }

      expect(actor.taps).toBe(1)
      expect(await readdir(dir)).toHaveLength(1)

      const replayActor = scriptedActor("Buy 500 credits")
      const second = await openWebSession({
        baseUrl: env.shopUrl,
        proxy: env.proxy,
        model: replayActor,
        cache,
      })

      try {
        await second.app.open("/")
        await second.agent.act("buy 500 credits")
        await second.expect(second.screen.getByTestId("checkout-total")).toContainText("$5.00")
      } finally {
        await second.close()
      }

      /*
       * The replay performs every recorded action and checks the end route itself: no model call
       * at all, although each run's Checkout Session has a new id.
       */
      expect(replayActor.taps).toBe(0)
      expect(replayActor.doGenerateCalls.length).toBe(0)
    })
  }, 120_000)

  it("does not save a step whose follow-up verification fails", async () => {
    await withCacheDir(async (dir) => {
      const cache = { dir, mode: "read-write" as const, journey: "unverified", appIdentity: "shop" }
      const session = await openWebSession({
        baseUrl: env.shopUrl,
        proxy: env.proxy,
        model: scriptedActor("Buy 500 credits"),
        cache,
        assertionTimeout: 1_000,
      })

      try {
        await session.app.open("/")
        await session.agent.act("buy 500 credits")
        await expect(
          session.expect(session.screen.getByTestId("checkout-total")).toContainText("$999.00"),
        ).rejects.toThrow(/toContainText\("\$999\.00"\) failed/)
      } finally {
        await session.close()
      }

      expect(await readdir(dir).catch(() => [])).toHaveLength(0)
    })
  }, 120_000)
  it("fails a strict-stop replay that has nothing recorded, instead of passing on nothing", async () => {
    await withCacheDir(async (dir) => {
      const actor = scriptedActor("Buy 500 credits")
      const session = await openWebSession({
        baseUrl: env.shopUrl,
        proxy: env.proxy,
        model: actor,
        cache: { dir, mode: "read-only", journey: "never-recorded", appIdentity: "shop" },
        replay: { mode: "strict-stop" },
      })

      try {
        await session.app.open("/")
        await expect(session.agent.act("buy 500 credits")).rejects.toThrow(
          /nothing recorded to replay for step 0/,
        )
        expect(session.divergence()).toBeUndefined()
      } finally {
        await session.close()
      }

      expect(actor.doGenerateCalls.length).toBe(0)
    })
  }, 120_000)
})

describe("agent.assert", () => {
  it("passes when the judge says the assertion holds and fails when it does not", async () => {
    const holds = await openWebSession({
      baseUrl: env.shopUrl,
      proxy: env.proxy,
      model: scriptedActor("unused"),
      judge: scriptedJudge("holds"),
    })

    try {
      await holds.app.open("/")
      await holds.agent.assert("the page offers to buy 500 credits")
    } finally {
      await holds.close()
    }

    const fails = await openWebSession({
      baseUrl: env.shopUrl,
      proxy: env.proxy,
      model: scriptedActor("unused"),
      judge: scriptedJudge("fails"),
    })

    try {
      await fails.app.open("/")
      await expect(fails.agent.assert("the page shows 999 credits")).rejects.toThrow(
        /scripted: fails/,
      )
    } finally {
      await fails.close()
    }
  }, 120_000)
})
