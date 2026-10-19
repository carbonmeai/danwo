import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { gateway, type LanguageModelMiddleware, wrapLanguageModel } from "ai"
import { afterEach, beforeEach, describe, it } from "vitest"

import { openWebSession } from "../src/session.ts"
import { type ShopEnvironment, startShopEnvironment } from "./environment.ts"

/*
 * Live tests call real models and cost money, so they run only on request: `DANWO_LIVE=1`.
 * The Gateway key comes from the environment, the repo's git-ignored .env, or the fidelity key
 * in .env.fidelity; without one they skip too.
 */
const ENV_FILES = [".env", ".env.fidelity"].map((name) =>
  fileURLToPath(new URL(`../../../${name}`, import.meta.url)),
)
const requested = process.env.DANWO_LIVE === "1"

if (requested) {
  for (const file of ENV_FILES) if (existsSync(file)) process.loadEnvFile(file)

  const fidelityKey = process.env.DANWO_FIDELITY_AI_GATEWAY_KEY

  if (process.env.AI_GATEWAY_API_KEY === undefined && fidelityKey !== undefined)
    process.env.AI_GATEWAY_API_KEY = fidelityKey
}

/** Gateway model ids, checked against https://ai-gateway.vercel.sh/v1/models on 2026-10-16. */
const MODELS = {
  claude: "anthropic/claude-sonnet-5.5",
  gpt: "openai/gpt-6-luna",
} as const

interface Usage {
  calls: number
  inputTokens: number
  outputTokens: number
}

/** Wraps a Gateway model so a test can report how many calls and tokens it spent. */
function counted(id: string, usage: Usage) {
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()

      usage.calls++
      usage.inputTokens += result.usage.inputTokens.total ?? 0
      usage.outputTokens += result.usage.outputTokens.total ?? 0

      return result
    },
    wrapStream: async ({ doStream }) => {
      usage.calls++

      return doStream()
    },
  }

  return wrapLanguageModel({ model: gateway(id), middleware })
}

const live = requested && process.env.AI_GATEWAY_API_KEY ? describe : describe.skip

live("live journey through the Vercel AI Gateway", () => {
  let env: ShopEnvironment

  // A fresh shop per case: credits are per user, and every case buys as the same user.
  beforeEach(async () => {
    env = await startShopEnvironment()
  }, 60_000)

  afterEach(async () => {
    await env?.close()
  })

  for (const [label, actorId, judgeId] of [
    ["Claude acts, GPT judges", MODELS.claude, MODELS.gpt],
    ["GPT acts, Claude judges", MODELS.gpt, MODELS.claude],
  ] as const) {
    it(`buys 500 credits in plain language (${label})`, async () => {
      const actor: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 }
      const judge: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 }
      const started = Date.now()
      const session = await openWebSession({
        baseUrl: env.shopUrl,
        proxy: env.proxy,
        model: counted(actorId, actor),
        judge: counted(judgeId, judge),
      })

      try {
        const { app, agent, screen, expect } = session

        await app.open("/")
        await agent.act("buy 500 credits")
        await agent.act("pay for the order on the checkout page")
        await expect(
          screen.getByRole("heading", { name: "Thank you for your purchase" }),
        ).toBeVisible()
        await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 500")
        await agent.assert("the page confirms the purchase and shows 500 credits")
      } finally {
        await session.close()
        console.info(
          `[live] ${label}: actor ${actorId} ${JSON.stringify(actor)}, judge ${judgeId} ${JSON.stringify(judge)}, ${Date.now() - started} ms`,
        )
      }
    }, 300_000)
  }
})
