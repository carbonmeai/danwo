import { describe, expect, it } from "vitest"

import {
  answersFromFlags,
  defaultAgents,
  defaultAnswers,
  defaultEngine,
  InitUsageError,
  parseList,
} from "../src/answers.ts"
import { AGENTS } from "../src/catalog.ts"
import { detectProject } from "../src/detect.ts"
import { nextApp, project } from "./project.ts"

async function nextDetection(env: NodeJS.ProcessEnv = {}) {
  return detectProject(await project({ "package.json": nextApp({ stripe: "17.0.0" }) }), env)
}

describe("the defaults", () => {
  it("test a web app on the gateway, with the providers found and installing on", async () => {
    expect(defaultAnswers(await nextDetection())).toMatchObject({
      engine: "web",
      modelSource: "gateway",
      model: "anthropic/claude-sonnet-5",
      providers: ["stripe"],
      agents: ["claude", "agents"],
      mcp: true,
      install: true,
      devCommand: "npm run dev",
      appUrl: "http://localhost:3000",
      replaceConfig: false,
    })
  })

  it("pick the model source whose key is already set", async () => {
    expect(defaultAnswers(await nextDetection({ ANTHROPIC_API_KEY: "x" }))).toMatchObject({
      modelSource: "anthropic",
      model: "claude-sonnet-5",
    })
  })

  it("drive Android for an Expo app, and teach the agents the project has", () => {
    expect(defaultEngine({ framework: { id: "expo", label: "Expo", port: 8081 } })).toBe("mobile")
    expect(defaultAgents({ agents: ["cursor"] })).toEqual(["cursor"])
  })
})

describe("flags", () => {
  it("override the defaults, each on its own", async () => {
    const answers = answersFromFlags(await nextDetection(), {
      engine: "both",
      modelSource: "openai-compatible",
      model: "llama3",
      keyEnv: "GPU_KEY",
      providers: "resend, s3",
      skills: "cursor,codex",
      mcp: false,
      skipInstall: true,
      devCommand: "pnpm dev",
      appUrl: "http://localhost:4000",
      force: true,
    })

    expect(answers).toMatchObject({
      engine: "both",
      modelSource: "openai-compatible",
      model: "llama3",
      baseUrl: "http://localhost:11434/v1",
      keyEnv: "GPU_KEY",
      providers: ["resend", "s3"],
      agents: ["cursor", "codex"],
      mcp: false,
      install: false,
      devCommand: "pnpm dev",
      appUrl: "http://localhost:4000",
      replaceConfig: true,
    })
  })

  it("take the source's suggested model, and no model with no source", async () => {
    const detection = await nextDetection()

    expect(answersFromFlags(detection, { modelSource: "openai" }).model).toBe("gpt-5")
    expect(answersFromFlags(detection, { modelSource: "none", model: "x" }).model).toBeUndefined()
  })

  it("refuse values they do not take, naming the choices", async () => {
    const detection = await nextDetection()

    expect(() => answersFromFlags(detection, { engine: "ios" })).toThrow(
      "--engine: ios is not one of web, mobile, both, none",
    )
    expect(() => answersFromFlags(detection, { providers: "stripe,paypal" })).toThrow(
      InitUsageError,
    )
    expect(() => answersFromFlags(detection, { appUrl: "localhost" })).toThrow("is not a URL")
    expect(() =>
      answersFromFlags(detection, { modelSource: "openai-compatible", baseUrl: "nope" }),
    ).toThrow("--base-url")
  })
})

describe("parseList", () => {
  it("reads a comma-separated list, none, and drops repeats", () => {
    expect(parseList("--skills", "none", AGENTS)).toEqual([])
    expect(parseList("--skills", "claude,claude, codex", AGENTS)).toEqual(["claude", "codex"])
    expect(() => parseList("--skills", "vim", AGENTS)).toThrow(
      "--skills: unknown vim; choose from claude, cursor, codex, copilot, agents, or none",
    )
  })
})
