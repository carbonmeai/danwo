/**
 * The agent on every kind of model `danwo init` can configure, and on Perplexity and Bedrock: each
 * provider's own AI SDK package pointed at the model API emulator, so the requests, tool calls and
 * usage go over each provider's real wire format. A step acts, the judge asserts, and the step
 * records its tokens.
 */
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createEmulator, type Emulator, llm, llmCalls, llmScripts, seedLlm } from "@danwo/emulators"
import { createGateway, type LanguageModel } from "ai"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { priced } from "../src/model/priced.ts"
import { usageOf } from "../src/record/usage.ts"
import { openWebSession } from "../src/session.ts"
import { type ShopEnvironment, startShopEnvironment } from "./environment.ts"

const KEY = "sk-test-danwo-model-sources"
const BUTTON = "Buy 500 credits"

let env: ShopEnvironment

beforeAll(async () => {
  env = await startShopEnvironment()
}, 60_000)

afterAll(async () => {
  await env.close()
})

/**
 * The model API emulator with the step's answers: the judge says the claim holds, and once a
 * click's result is back the actor ends the step. The click itself is scripted by `actorFetch`,
 * which reads the button's ref from the page view the actor is sent.
 */
function modelApi(): Emulator {
  const emulator = createEmulator(llm)

  seedLlm(emulator.store, {
    scripts: [
      {
        name: "judge",
        match: { user: /^Claim:/m },
        reply: { text: JSON.stringify({ verdict: "holds", reason: "the total shows $5.00" }) },
      },
      {
        name: "done",
        match: { tool: "done", toolResult: true },
        reply: {
          toolCalls: [{ name: "done", arguments: { status: "passed", summary: "bought" } }],
        },
      },
    ],
  })

  return emulator
}

/** A fetch answered by the emulator in-process, scripting the click on the actor's first turn. */
function actorFetch(emulator: Emulator): typeof fetch {
  const button = new RegExp(`button \\\\?"${BUTTON}\\\\?"[^\\[\\n]*\\[ref=(e\\d+)\\]`)
  let scripted = false

  return async (input, init) => {
    const request = new Request(input, init)
    const ref = button.exec(await request.clone().text())?.[1]

    if (ref !== undefined && !scripted) {
      scripted = true
      llmScripts(emulator).add({
        name: "click",
        match: { tool: "click", toolResult: false },
        reply: { toolCalls: [{ name: "click", arguments: { ref } }] },
      })
    }

    return emulator.fetch(request)
  }
}

/** Each model source init offers, as its own provider package builds the model. */
const SOURCES: readonly {
  readonly name: string
  readonly api: string
  readonly model: (fetch: typeof globalThis.fetch) => Exclude<LanguageModel, string>
}[] = [
  {
    name: "OpenAI (Responses API)",
    api: "responses",
    model: (fetch) => createOpenAI({ apiKey: KEY, fetch })("gpt-5-mini"),
  },
  {
    name: "OpenAI (Chat Completions)",
    api: "chat",
    model: (fetch) => createOpenAI({ apiKey: KEY, fetch }).chat("gpt-5-mini"),
  },
  {
    name: "Anthropic",
    api: "messages",
    model: (fetch) => createAnthropic({ apiKey: KEY, fetch })("claude-sonnet-5"),
  },
  {
    name: "an OpenAI-compatible server",
    api: "chat",
    model: (fetch) =>
      createOpenAICompatible({
        name: "local",
        baseURL: "https://api.openai.com/v1",
        apiKey: KEY,
        fetch,
      })("qwen3"),
  },
  {
    name: "the AI Gateway",
    api: "language-model",
    model: (fetch) => createGateway({ apiKey: KEY, fetch })("anthropic/claude-sonnet-5"),
  },
  {
    name: "Google Gemini",
    api: "gemini",
    model: (fetch) => createGoogleGenerativeAI({ apiKey: KEY, fetch })("gemini-2.5-flash"),
  },
  {
    name: "Perplexity",
    api: "agent",
    model: (fetch) => createPerplexity({ apiKey: KEY, fetch })("sonar-pro"),
  },
  {
    name: "Amazon Bedrock",
    api: "converse",
    model: (fetch) =>
      createAmazonBedrock({
        region: "us-east-1",
        accessKeyId: "REDACTED-TEST-VALUE",
        secretAccessKey: "danwo-emulated-secret",
        fetch,
      })("us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
  },
]

describe("the agent on each model source", () => {
  for (const source of SOURCES)
    it(`acts and asserts on ${source.name}`, async () => {
      const emulator = modelApi()
      const fetch = actorFetch(emulator)
      const session = await openWebSession({
        baseUrl: env.shopUrl,
        proxy: env.proxy,
        model: source.model(fetch),
      })

      try {
        await session.app.open("/")
        await session.agent.act("buy 500 credits")
        await session.expect(session.screen.getByTestId("checkout-total")).toContainText("$5.00")
        await session.agent.assert("the checkout total is $5.00")

        const calls = llmCalls(emulator).all()

        expect(calls.map((call) => call.script)).toEqual(["click", "done", "judge"])
        expect(new Set(calls.map((call) => call.api))).toEqual(new Set([source.api]))
        expect(usageOf(session.flight.steps()).spent.tokens[0]).toBeGreaterThan(0)
      } finally {
        await session.close()
      }
    }, 60_000)

  it("prices a provider's calls with priced(), so spend and dollar budgets work", async () => {
    const emulator = modelApi()
    const model = createAnthropic({ apiKey: KEY, fetch: actorFetch(emulator) })("claude-sonnet-5")
    const session = await openWebSession({
      baseUrl: env.shopUrl,
      proxy: env.proxy,
      model: priced(model, { input: 3, output: 15 }),
    })

    try {
      await session.app.open("/")
      await session.agent.act("buy 500 credits")

      const { spent } = usageOf(session.flight.steps())
      const [input, output] = spent.tokens

      expect(spent.usd).toBeCloseTo((input * 3 + output * 15) / 1e6, 10)
    } finally {
      await session.close()
    }
  }, 60_000)
})
