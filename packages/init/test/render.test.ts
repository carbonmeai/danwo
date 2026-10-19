import { parseSync } from "oxc-parser"
import { describe, expect, it } from "vitest"

import { type Answers, defaultAnswers } from "../src/answers.ts"
import { MODEL_SOURCE_INFO, MODEL_SOURCES, type ModelSourceId } from "../src/catalog.ts"
import { detectProject } from "../src/detect.ts"
import {
  envExampleNames,
  renderApiTest,
  renderMobileConfig,
  renderMobileTest,
  renderWebConfig,
  renderWebTest,
  wrapped,
} from "../src/render.ts"
import { nextApp, project } from "./project.ts"

/** The answers for a plain Next.js app, with `changes`. */
async function answers(changes: Partial<Answers> = {}): Promise<Answers> {
  const detection = await detectProject(await project({ "package.json": nextApp() }), {})

  return { ...defaultAnswers(detection), ...changes }
}

/** The syntax errors in `text` as TypeScript, by message. */
function syntaxErrors(text: string): string[] {
  return parseSync("danwo.config.ts", text).errors.map((error) => error.message)
}

const MODELS: Readonly<Record<Exclude<ModelSourceId, "none">, string>> = {
  gateway: 'model: "anthropic/claude-sonnet-5"',
  anthropic: 'model: anthropic("claude-sonnet-5")',
  openai: 'model: openai("gpt-5")',
  google: 'model: google("gemini-2.5-pro")',
  openrouter: 'model: openrouter("anthropic/claude-sonnet-5")',
  "openai-compatible": 'model: compatible("qwen3")',
}

/** The web config for the model `source` suggests, emulating Stripe and Resend. */
async function configFor(source: ModelSourceId): Promise<string> {
  return renderWebConfig(
    await answers({
      modelSource: source,
      model: MODEL_SOURCE_INFO[source].model,
      baseUrl: source === "openai-compatible" ? "http://localhost:11434/v1" : undefined,
      providers: ["stripe", "resend"],
    }),
    "tests",
  )
}

describe("the web config", () => {
  for (const source of MODEL_SOURCES.filter((id) => id !== "none"))
    it(`is valid TypeScript with the model from ${source}`, async () => {
      const text = await configFor(source)

      expect(syntaxErrors(text)).toEqual([])
      expect(text).toContain(MODELS[source])
      expect(text).toContain("services: [stripeService(), resendService()]")
      expect(text).toContain(
        'import { appEnvironment, defineConfig, resendService, stripeService } from "@danwo/sdk"',
      )
    })

  it("has no model, and says how to add one, with no model source", async () => {
    const text = await configFor("none")

    expect(syntaxErrors(text)).toEqual([])
    expect(text).not.toMatch(/^\s+model:/m)
    expect(text).toContain("No model: tests use locators.")
  })

  it("starts the app with its dev command unless APP_URL names one that runs", async () => {
    const text = renderWebConfig(await answers({ providers: [] }), "tests")

    expect(text).toContain(
      'const app = process.env.APP_URL ?? { command: "npm run dev", url: "http://localhost:3000" }',
    )
    expect(text).toContain("services: []")
    expect(text).toContain("through danwo's proxy; add services below")
  })

  it("reads an OpenAI-compatible server's key only when it takes one", async () => {
    const base = {
      modelSource: "openai-compatible",
      model: "llama3",
      baseUrl: "http://gpu:8000/v1",
    } as const
    const keyed = renderWebConfig(await answers({ ...base, keyEnv: "GPU_KEY" }), "tests")
    const open = renderWebConfig(await answers({ ...base, keyEnv: undefined }), "tests")

    expect(keyed).toContain("apiKey: process.env.GPU_KEY,")
    expect(keyed).toContain('baseURL: "http://gpu:8000/v1"')
    expect(open).not.toContain("apiKey")
    expect(envExampleNames({ modelSource: "openai-compatible", keyEnv: undefined })).toEqual([])
    expect(envExampleNames({ modelSource: "gateway", keyEnv: undefined })).toEqual([
      "AI_GATEWAY_API_KEY",
    ])
  })
})

describe("the mobile config", () => {
  it("builds the Expo app and boots its AVD, with app.json's package and scheme", async () => {
    const text = renderMobileConfig(
      await answers({ engine: "mobile", providers: ["stripe"], avd: "pixel_api_34" }),
      { expo: { androidPackage: "com.acme.shop", scheme: "shop" } },
      "tests",
    )

    expect(syntaxErrors(text)).toEqual([])
    expect(text).toContain('const AVD = process.env.DANWO_AVD ?? "pixel_api_34"')
    expect(text).toContain('app: { package: "com.acme.shop", apk: build.apk, scheme: "shop" }')
    expect(text).toContain("appEnvironment({ services: [stripeService()] })")
  })

  it("stands in for what app.json leaves out", async () => {
    const text = renderMobileConfig(
      await answers({ engine: "mobile" }),
      { expo: undefined },
      "tests",
    )

    expect(text).toContain('app: { package: "com.example.app", apk: build.apk }')
    expect(text).toContain('?? "danwo"')
  })
})

describe("the example tests", () => {
  it("are valid TypeScript, with the agent and emulators shown in comments", async () => {
    const chosen = await answers({ providers: ["stripe", "s3"] })

    for (const text of [renderWebTest(chosen), renderApiTest(chosen), renderMobileTest(chosen)])
      expect(syntaxErrors(text)).toEqual([])
    expect(renderWebTest(chosen)).toContain("Stripe and S3 are emulated")
    expect(renderWebTest(chosen)).toContain("s3: s3Objects(s3)")
    expect(renderWebTest(chosen)).toContain('agent.assert("the page shows')
    expect(renderWebTest(await answers({ modelSource: "none", providers: [] }))).not.toMatch(
      /agent|emulated/,
    )
  })
})

describe("wrapped", () => {
  it("breaks text at words to fit the width, each line prefixed", () => {
    expect(wrapped("one two three four", " * ", 12)).toEqual([" * one two", " * three", " * four"])
    expect(wrapped("short", "// ")).toEqual(["// short"])
  })
})
