import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { deviceCheckOf } from "../src/device.ts"
import { runInit } from "../src/index.ts"
import { installCommand, installPackages, type Runner } from "../src/install.ts"
import type { Choice, Prompter } from "../src/prompter.ts"
import { nextApp, project } from "./project.ts"

/** A package manager that records what it was asked to run and succeeds. */
function recordingRunner(): Runner & { calls: string[][] } {
  const calls: string[][] = []

  const run: Runner = async (argv) => {
    calls.push([...argv])

    return { ok: true, output: "" }
  }

  return Object.assign(run, { calls })
}

const noDevice = async () => ({ problems: ["Android SDK: not found"], avd: undefined })

/** The values of `choices` that `wanted` names. */
function pick<T extends string>(choices: readonly Choice<T>[], wanted: readonly string[]): T[] {
  return choices.filter((choice) => wanted.includes(choice.value)).map((choice) => choice.value)
}

/** A package manager that cannot find danwo's packages. */
const failing: Runner = async () => ({ ok: false, output: "line 1\nERR! 404 @danwo/cli" })

/**
 * A person at the prompts: answers are taken in order by the question's first words, and a
 * question with no answer given takes its default.
 */
function scriptedPrompter(
  answers: Readonly<Record<string, string | boolean | readonly string[]>>,
): Prompter & { notes: string[]; asked: string[] } {
  const notes: string[] = []
  const asked: string[] = []

  const answerTo = (message: string) => {
    asked.push(message)

    const key = Object.keys(answers).find((start) => message.startsWith(start))

    return key === undefined ? undefined : answers[key]
  }

  return {
    notes,
    asked,
    intro: () => undefined,
    outro: (text) => notes.push(text),
    note: (text, title) => notes.push(`${title}: ${text}`),
    async select(message, choices, initial) {
      const answer = answerTo(message)

      return typeof answer === "string" ? (pick(choices, [answer])[0] ?? initial) : initial
    },
    async multiselect(message, choices, initial) {
      const answer = answerTo(message)

      return Array.isArray(answer) ? pick(choices, answer) : [...initial]
    },
    async text(message, initial, check) {
      const answer = answerTo(message)
      const value = typeof answer === "string" ? answer : initial

      expect(check?.(value)).toBeUndefined()

      return value
    },
    async confirm(message, initial) {
      const answer = answerTo(message)

      return typeof answer === "boolean" ? answer : initial
    },
    task: async (_message, work, done) => {
      const value = await work()

      notes.push(done(value))

      return value
    },
  }
}

const read = (root: string, file: string) => readFile(join(root, file), "utf8")

describe("danwo init without prompts", () => {
  it("sets up a Next.js app from flags and detection, installing with its package manager", async () => {
    const root = await project({
      "package.json": nextApp({ stripe: "17.0.0" }),
      "pnpm-lock.yaml": "",
    })
    const run = recordingRunner()
    const { summary, answers } = await runInit({
      cwd: root,
      flags: { yes: true, modelSource: "anthropic", skills: "claude,codex,copilot" },
      env: {},
      run,
      checkDevice: noDevice,
    })

    expect(answers).toMatchObject({
      engine: "web",
      providers: ["stripe"],
      agents: ["claude", "codex", "copilot"],
    })
    expect(await read(root, ".vscode/mcp.json")).toContain('"type": "stdio"')
    expect(run.calls).toEqual([
      ["pnpm", "add", "-D", "@danwo/cli", "@danwo/sdk", "@ai-sdk/anthropic@4.0.82"],
    ])
    expect(await read(root, "danwo.config.ts")).toContain('model: anthropic("claude-sonnet-5")')
    expect(existsSync(join(root, ".claude/skills/danwo/SKILL.md"))).toBe(true)
    expect(existsSync(join(root, ".agents/skills/danwo/SKILL.md"))).toBe(true)
    expect(await read(root, ".codex/config.toml")).toContain("[mcp_servers.danwo]")
    expect(existsSync(join(root, ".cursor/mcp.json"))).toBe(false)
    expect(summary).toContain("added: pnpm add -D @danwo/cli")
    expect(summary).toContain("Set ANTHROPIC_API_KEY for Anthropic")
    expect(summary).toContain(
      "Run the example: pnpm test:danwo. danwo starts `pnpm dev` at http://localhost:3000 with Stripe emulated.",
    )
  })

  it("sets up a Vite app with no skills, no install and an API engine", async () => {
    const root = await project({
      "package.json": {
        name: "spa",
        scripts: { dev: "vite --port 5300" },
        devDependencies: { vite: "7.0.0" },
      },
    })
    const run = recordingRunner()
    const { summary } = await runInit({
      cwd: root,
      flags: { yes: true, engine: "none", skills: "none", skipInstall: true, modelSource: "none" },
      env: {},
      run,
      checkDevice: noDevice,
    })

    expect(run.calls).toEqual([])
    expect(await read(root, "danwo.config.ts")).toContain('url: "http://localhost:5300"')
    expect(await read(root, "tests/example.danwo.ts")).toContain('test("the app answers"')
    expect(existsSync(join(root, ".claude"))).toBe(false)
    expect(summary).toContain("not installed: run npm install -D @danwo/cli @danwo/sdk")
    expect(summary).toContain("No model")
  })

  it("is idempotent, and says a failed install's command and output", async () => {
    const root = await project({ "package.json": nextApp() })
    const options = {
      cwd: root,
      flags: { yes: true },
      env: { AI_GATEWAY_API_KEY: "k" },
      run: failing,
      checkDevice: noDevice,
    }

    const first = await runInit(options)
    const second = await runInit(options)

    expect(first.summary).toContain("failed: npm install -D @danwo/cli @danwo/sdk")
    expect(first.summary).toContain("ERR! 404 @danwo/cli")
    expect(first.summary).toContain("AI_GATEWAY_API_KEY is set")
    expect(second.result.files.every((file) => file.outcome === "unchanged")).toBe(true)
  })

  it("writes a mobile config for an Expo app on the AVD the device check found", async () => {
    const root = await project({
      "package.json": { name: "app", dependencies: { expo: "54.0.0" } },
      "app.json": { expo: { android: { package: "com.acme.app" } } },
    })
    const { answers, summary } = await runInit({
      cwd: root,
      flags: { yes: true, skipInstall: true },
      env: {},
      checkDevice: async () => ({ problems: [], avd: "pixel" }),
    })

    expect(answers).toMatchObject({ engine: "mobile", avd: "pixel" })
    expect(await read(root, "danwo.config.ts")).toContain('?? "pixel"')
    expect(await read(root, "tests/example.danwo.ts")).toContain('test("the app starts"')
    expect(summary).toContain("danwo device doctor")
    expect(summary).toContain(
      "not installed: run npm install -D @danwo/cli @danwo/sdk @danwo/device @danwo/expo",
    )
  })
})

describe("danwo init at the prompts", () => {
  it("asks each question, starting on what it found, and writes what was chosen", async () => {
    const root = await project({ "package.json": nextApp({ resend: "4.0.0" }), "bun.lock": "" })
    const prompter = scriptedPrompter({
      "What should tests drive?": "both",
      "How does the app start?": "bun run dev --port 4400",
      "Where does it answer": "http://localhost:4400",
      "Which model should agent steps use?": "openai-compatible",
      "Where does the server answer?": "http://gpu.local:8000/v1",
      "Which variable holds its key?": "GPU_KEY",
      "Which model?": "llama3.3",
      "Which providers": ["resend", "twilio"],
      "Which coding agents": ["cursor"],
      "Register danwo's MCP server": false,
      Add: false,
    })
    const run = recordingRunner()
    const { answers } = await runInit({
      cwd: root,
      flags: {},
      prompter,
      env: {},
      run,
      checkDevice: noDevice,
    })

    expect(answers).toMatchObject({
      engine: "both",
      devCommand: "bun run dev --port 4400",
      modelSource: "openai-compatible",
      baseUrl: "http://gpu.local:8000/v1",
      keyEnv: "GPU_KEY",
      model: "llama3.3",
      providers: ["resend", "twilio"],
      agents: ["cursor"],
      mcp: false,
      install: false,
    })
    expect(run.calls).toEqual([])
    expect(prompter.notes.join("\n")).toContain("Android SDK: not found")
    expect(prompter.notes.join("\n")).toContain("Set GPU_KEY")
    expect(await read(root, "danwo.config.ts")).toContain('baseURL: "http://gpu.local:8000/v1"')
    expect(await read(root, "danwo.mobile.config.ts")).toContain("twilioService()")
    expect(existsSync(join(root, ".agents/skills/danwo/SKILL.md"))).toBe(true)
    expect(existsSync(join(root, ".cursor/mcp.json"))).toBe(false)
  })

  it("skips questions flags answered, and shows the change before replacing a config", async () => {
    const root = await project({
      "package.json": nextApp(),
      "danwo.config.ts": "export default {}\n",
    })
    const prompter = scriptedPrompter({ Replace: true })

    await runInit({
      cwd: root,
      flags: {
        engine: "web",
        modelSource: "gateway",
        model: "openai/gpt-5",
        providers: "none",
        skills: "none",
      },
      prompter,
      env: {},
      run: recordingRunner(),
      checkDevice: noDevice,
    })

    expect(prompter.asked).toEqual([
      "How does the app start?",
      "Where does it answer once started?",
      "Add @danwo/cli, @danwo/sdk with npm?",
      "Replace danwo.config.ts?",
    ])
    expect(prompter.notes.join("\n")).toContain("- export default {}")
    expect(await read(root, "danwo.config.ts")).toContain('model: "openai/gpt-5"')
  })

  it("leaves the config alone when the person says no", async () => {
    const root = await project({
      "package.json": nextApp(),
      "danwo.config.ts": "export default {}\n",
    })

    await runInit({
      cwd: root,
      flags: {
        engine: "web",
        providers: "none",
        skills: "none",
        skipInstall: true,
        modelSource: "none",
      },
      prompter: scriptedPrompter({}),
      env: {},
      checkDevice: noDevice,
    })

    expect(await read(root, "danwo.config.ts")).toBe("export default {}\n")
  })
})

describe("installing", () => {
  it("uses each package manager's own command, with pinned versions", () => {
    const specs = [
      { name: "@danwo/sdk", version: "latest" },
      { name: "@ai-sdk/openai", version: "4.0.96" },
    ]

    expect(installCommand("bun", specs)).toEqual([
      "bun",
      "add",
      "-d",
      "@danwo/sdk",
      "@ai-sdk/openai@4.0.96",
    ])
    expect(installCommand("yarn", specs).slice(0, 3)).toEqual(["yarn", "add", "-D"])
  })

  it("keeps the last lines of a failed install", async () => {
    const output = Array.from({ length: 20 }, (_, n) => `line ${n}`).join("\n")
    const result = await installPackages("/", "npm", [], async () => ({ ok: false, output }))

    expect(result.output.split("\n")).toHaveLength(8)
    expect(result.output).toContain("line 19")
  })
})

describe("the device check", () => {
  it("lists what to fix and the first AVD that passed", () => {
    expect(
      deviceCheckOf([
        { name: "Android SDK", status: "ok", detail: "/sdk" },
        { name: "AVD play", status: "warn", detail: "a Google Play image cannot be rooted" },
        { name: "AVD pixel", status: "ok", detail: "system-images/android-34" },
        { name: "JDK", status: "warn", detail: "not found" },
      ]),
    ).toEqual({
      problems: ["AVD play: a Google Play image cannot be rooted", "JDK: not found"],
      avd: "pixel",
    })
  })
})
