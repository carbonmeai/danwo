/**
 * Models backed by a coding CLI the user signed in to, driven against a stand-in CLI run with Node:
 * the prompt goes in as text with the tools and their schemas, the answer comes back as tool calls,
 * the CLI starts read-only and sandboxed in an empty folder, and each way it can fail (not
 * installed, not signed in, out of plan quota, too slow, an answer in the wrong shape) ends with a
 * code and the command that fixes it.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { LanguageModelV4CallOptions } from "@ai-sdk/provider"
import { generateText, jsonSchema, tool } from "ai"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { codexArgs, codexCli, type CodexCliOptions } from "../src/model/cli/codex.ts"
import { excerpt } from "../src/model/cli/failure.ts"
import { cliStatusOf } from "../src/model/cli/model.ts"
import { answerContent, cliPrompt } from "../src/model/cli/protocol.ts"
import { cliPlan } from "../src/model/cli/run.ts"
import { usageOf } from "../src/record/usage.ts"
import { openWebSession } from "../src/session.ts"
import { ownedCount } from "../src/support/children.ts"
import { type ShopEnvironment, startShopEnvironment } from "./environment.ts"

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.ts", import.meta.url))
const BUTTON = "Buy 500 credits"
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const made: string[] = []

afterEach(async () => {
  await Promise.all(
    made
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  )
})

/** A Codex model on the stand-in, in `mode`, logging each run to a file of its own. */
async function fakeCodex(
  mode: string,
  options: CodexCliOptions = {},
): Promise<{ model: ReturnType<typeof codexCli>; runs: () => Promise<Run[]> }> {
  const dir = await mkdtemp(join(tmpdir(), "danwo-fake-codex-"))
  const log = join(dir, "runs.jsonl")

  made.push(dir)

  return {
    model: codexCli({
      command: [process.execPath, FAKE],
      env: { FAKE_CLI_MODE: mode, FAKE_CLI_LOG: log, FAKE_CLI_BUTTON: BUTTON },
      ...options,
    }),
    async runs() {
      const text = await readFile(log, "utf8").catch(() => "")

      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line): Run => JSON.parse(line))
    },
  }
}

interface Run {
  readonly args: string[]
  readonly prompt: string
  readonly cwd: string
  readonly workEntries: string[] | null
  readonly images: boolean[]
}

const clickTool = {
  type: "function" as const,
  name: "click",
  description: "Clicks an element by its ref.",
  inputSchema: {
    type: "object" as const,
    properties: { ref: { type: "string" as const } },
    required: ["ref"],
  },
}

/** A call like the agent's: a system prompt, the page with a screenshot, then a click's result. */
function agentCall(): LanguageModelV4CallOptions {
  return {
    prompt: [
      { role: "system", content: "You drive a browser." },
      {
        role: "user",
        content: [
          { type: "text", text: `Step: buy credits\n\n- button "${BUTTON}" [ref=e5]` },
          { type: "file", mediaType: "image/png", data: { type: "data", data: PNG } },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "click", input: { ref: "e4" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "click",
            output: {
              type: "content",
              value: [
                { type: "text", text: "clicked e4" },
                { type: "file", mediaType: "image/png", data: { type: "data", data: PNG } },
              ],
            },
          },
        ],
      },
    ],
    tools: [clickTool],
    toolChoice: { type: "required" },
  }
}

describe("a model call as a CLI prompt", () => {
  it("writes the conversation, the tools and the answer's shape as one text", () => {
    const prompt = cliPrompt(agentCall(), 2)

    expect(prompt.system).toBe("You drive a browser.")
    expect(prompt.text).toContain(`- button "${BUTTON}" [ref=e5]`)
    expect(prompt.text).toContain('You called click (call call-1) with {"ref":"e4"}')
    expect(prompt.text).toContain(
      "## Result of click (call call-1)\n\nclicked e4\n[image 2, attached]",
    )
    expect(prompt.text).toContain(`- click: Clicks an element by its ref.`)
    expect(prompt.text).toContain('"required":["ref"]')
    expect(prompt.text).toContain("Make at least one call.")
    expect(prompt.images.map((image) => image.label)).toEqual(["image 1", "image 2"])
    expect(prompt.schema).toMatchObject({
      required: ["calls", "text"],
      additionalProperties: false,
      properties: { calls: { items: { properties: { tool: { enum: ["click"] } } } } },
    })
  })

  it("sends only the newest images, and none for text-only page views", () => {
    const one = cliPrompt(agentCall(), 1)
    const none = cliPrompt(agentCall(), 0)

    expect(one.images).toHaveLength(1)
    expect(one.text).toContain("[an earlier image, not shown]")
    expect(one.text).toContain("[image 1, attached]")
    expect(none.images).toEqual([])
    expect(none.text).not.toContain("attached]")
  })

  it("asks for plain text when there are no tools, and names what it cannot honour", () => {
    const prompt = cliPrompt(
      {
        prompt: [{ role: "user", content: [{ type: "text", text: "Claim: it holds" }] }],
        temperature: 0,
      },
      2,
    )

    expect(prompt.schema).toBeUndefined()
    expect(prompt.text).toContain("Answer the last message.")
    expect(prompt.warnings).toEqual([{ type: "unsupported", feature: "temperature" }])
  })

  it("turns the JSON answer into tool calls, and anything else into text", () => {
    let id = 0
    const next = () => `id-${++id}`

    expect(
      answerContent(
        '{"calls":[{"tool":"click","input":"{\\"ref\\":\\"e5\\"}"}],"text":"clicking"}',
        true,
        next,
      ),
    ).toEqual([
      { type: "text", text: "clicking" },
      { type: "tool-call", toolCallId: "id-1", toolName: "click", input: '{"ref":"e5"}' },
    ])
    expect(
      answerContent('```json\n{"calls":[{"tool":"done","input":{"ok":true}}]}\n```', true, next),
    ).toEqual([{ type: "tool-call", toolCallId: "id-2", toolName: "done", input: '{"ok":true}' }])
    expect(answerContent("I would click it.", true, next)).toEqual([
      { type: "text", text: "I would click it." },
    ])
    expect(answerContent('{"verdict":"holds"}', false, next)).toEqual([
      { type: "text", text: '{"verdict":"holds"}' },
    ])
  })

  it("masks anything key-like in what a CLI said", () => {
    expect(excerpt("bad key sk-proj-abcdefghijklmnop\nBearer abcdefghijkl.mnop")).toBe(
      "bad key *** ***",
    )
  })
})

describe("starting Codex", () => {
  const files = { work: "/tmp/danwo-cli-x/work", images: ["/tmp/danwo-cli-x/inputs/image-1.png"] }
  const args = codexArgs({ model: "gpt-5-codex", reasoningEffort: "low" }, files, {
    instructions: "/tmp/danwo-cli-x/inputs/instructions.md",
    schema: "/tmp/danwo-cli-x/inputs/answer.schema.json",
  })

  /** The value after `flag`. */
  const after = (flag: string) => args[args.indexOf(flag) + 1]

  it("runs read-only, sandboxed, with its tools off, saving nothing, in the empty folder", () => {
    expect(args[0]).toBe("exec")
    expect(after("--sandbox")).toBe("read-only")
    expect(after("--cd")).toBe(files.work)
    expect(args).toEqual(
      expect.arrayContaining([
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        'approval_policy="never"',
        'web_search="disabled"',
        "features.shell_tool=false",
        "features.unified_exec=false",
        "features.apps=false",
        'model_instructions_file="/tmp/danwo-cli-x/inputs/instructions.md"',
        'model_reasoning_effort="low"',
      ]),
    )
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(after("--image")).toBe(files.images[0])
    expect(after("--output-schema")).toBe("/tmp/danwo-cli-x/inputs/answer.schema.json")
    expect(after("--model")).toBe("gpt-5-codex")
    expect(args.at(-1)).toBe("-")
  })

  it("starts through cmd.exe on Windows, every argument quoted, so a .cmd shim starts", () => {
    const plan = cliPlan(
      "codex",
      ["exec", "-c", 'approval_policy="never"', "-"],
      "win32",
      "cmd.exe",
    )

    expect(plan.command).toBe("cmd.exe")
    expect(plan.windowsVerbatimArguments).toBe(true)
    expect(plan.args.slice(0, 3)).toEqual(["/d", "/s", "/c"])
    expect(plan.args[3]).toBe('"codex ^"exec^" ^"-c^" ^"approval_policy=\\^"never\\^"^" ^"-^""')
    expect(cliPlan(["node", "fake.ts"], ["--version"], "linux")).toEqual({
      command: "node",
      args: ["fake.ts", "--version"],
      windowsVerbatimArguments: false,
    })
  })
})

describe("a Codex model on the stand-in CLI", () => {
  it("answers a call with tool calls, its usage and the flags that keep it read-only", async () => {
    const { model, runs } = await fakeCodex("act")
    const result = await model.doGenerate(agentCall())

    expect(result.finishReason.unified).toBe("tool-calls")
    expect(result.content).toEqual([
      expect.objectContaining({ type: "tool-call", toolName: "done" }),
    ])
    expect(result.usage.inputTokens).toEqual({
      total: 1200,
      noCache: 1000,
      cacheRead: 200,
      cacheWrite: undefined,
    })
    expect(result.usage.outputTokens).toEqual({ total: 40, text: 30, reasoning: 10 })

    const [run] = await runs()

    expect(run?.args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ephemeral"]))
    expect(run?.prompt).toContain(`- button "${BUTTON}" [ref=e5]`)
    expect(run?.workEntries).toEqual([])
    expect(run?.images).toEqual([true, true])
  })

  it("runs a step through generateText, as the agent loop does", async () => {
    const { model } = await fakeCodex("act")
    const result = await generateText({
      model,
      prompt: `- button "${BUTTON}" [ref=e9]`,
      tools: {
        click: tool({ inputSchema: jsonSchema<{ ref: string }>(clickTool.inputSchema) }),
      },
      toolChoice: "required",
    })

    expect(result.toolCalls.map((call) => [call.toolName, call.input])).toEqual([
      ["click", { ref: "e9" }],
    ])
  })

  it("gives text for an answer in the wrong shape, which the loop counts as unusable", async () => {
    const { model } = await fakeCodex("malformed")
    const result = await model.doGenerate(agentCall())

    expect(result.content).toEqual([{ type: "text", text: "I would click the button." }])
    expect(result.finishReason.unified).toBe("stop")
  })

  it("records no tokens when the CLI reports none", async () => {
    const { model } = await fakeCodex("no-usage")
    const result = await model.doGenerate(agentCall())

    expect(result.usage.inputTokens.total).toBeUndefined()
    expect(result.usage.outputTokens.total).toBeUndefined()
  })

  it("stops a CLI that runs past its timeout, with its process tree", async () => {
    const { model } = await fakeCodex("hang", { timeoutMs: 1_500 })
    const before = ownedCount()

    await expect(model.doGenerate(agentCall())).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
      message: expect.stringMatching(/gave no answer in 2 s and was stopped/),
    })
    expect(ownedCount()).toBe(before)
  })

  it("stops the CLI when the step is aborted", async () => {
    const { model } = await fakeCodex("hang")
    const controller = new AbortController()

    setTimeout(() => controller.abort(new Error("run interrupted")), 500)

    await expect(
      model.doGenerate({ ...agentCall(), abortSignal: controller.signal }),
    ).rejects.toThrow("run interrupted")
  })

  it("says to run codex login when the CLI is not signed in", async () => {
    const { model, runs } = await fakeCodex("signed-out")

    await expect(model.doGenerate(agentCall())).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringContaining("Run `codex login`"),
    })
    expect(await runs()).toEqual([])
  })

  it("says to run codex login when a call is refused for a lapsed sign-in", async () => {
    const { model } = await fakeCodex("expired")

    await expect(model.doGenerate(agentCall())).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringMatching(/not signed in .*Run `codex login`/),
    })
  })

  it("names a used-up plan as the model being unavailable", async () => {
    const { model } = await fakeCodex("quota")

    await expect(model.doGenerate(agentCall())).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
      message: expect.stringContaining("hit your ChatGPT plan's usage or rate limit"),
    })
  })

  it("says how to install the CLI when it is missing", async () => {
    const model = codexCli({ command: "danwo-no-such-codex-cli" })

    await expect(model.doGenerate(agentCall())).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringMatching(/Codex CLI is not installed.*npm install -g @openai\/codex/),
    })
  })

  it("reports its version and sign-in for danwo doctor, from the CLI's own commands", async () => {
    const { model } = await fakeCodex("act")
    const signedOut = await fakeCodex("signed-out")

    expect(await cliStatusOf(model)).toEqual({
      title: "Codex CLI",
      login: "codex login",
      installed: true,
      version: "9.9.9",
      signedIn: true,
      detail: "signed in with ChatGPT",
    })
    expect(await cliStatusOf(signedOut.model)).toMatchObject({ installed: true, signedIn: false })
    expect(await cliStatusOf(codexCli({ command: "danwo-no-such-codex-cli" }))).toMatchObject({
      installed: false,
    })
    expect(cliStatusOf("openai/gpt-5")).toBeUndefined()
  })
})

describe("the agent on a Codex model", () => {
  let env: ShopEnvironment

  beforeAll(async () => {
    env = await startShopEnvironment()
  }, 60_000)

  afterAll(async () => {
    await env.close()
  })

  it("acts and asserts, one CLI run per model call, and records the tokens", async () => {
    const { model, runs } = await fakeCodex("act")
    const session = await openWebSession({ baseUrl: env.shopUrl, proxy: env.proxy, model })

    try {
      await session.app.open("/")
      await session.agent.act("buy 500 credits")
      await session.expect(session.screen.getByTestId("checkout-total")).toContainText("$5.00")
      await session.agent.assert("the checkout total is $5.00")

      const all = await runs()

      expect(all).toHaveLength(3)
      expect(all.every((run) => run.args.includes("read-only"))).toBe(true)
      expect(usageOf(session.flight.steps()).spent.tokens[0]).toBeGreaterThan(0)
    } finally {
      await session.close()
    }
  }, 60_000)
})
