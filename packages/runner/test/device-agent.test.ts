import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { describeNode, findNode } from "../src/device/agent/target.ts"
import { parseDeviceCall } from "../src/device/agent/tools.ts"
import { deviceRoute, treeText } from "../src/device/agent/view.ts"
import { type DeviceSession, openDeviceSession } from "../src/device/session.ts"
import type { DeviceForeground, DeviceNode, DeviceTarget } from "../src/device/types.ts"

function node(ref: string, fields: Partial<DeviceNode>): DeviceNode {
  const name = fields.name ?? ""

  return {
    ref,
    role: "generic",
    name,
    text: fields.text ?? name,
    editable: false,
    password: false,
    enabled: true,
    ...fields,
  }
}

/** The shop's home screen, with the buy button named `buy`. */
function home(buy = "Buy 500 credits", credits = 0): DeviceNode[] {
  return [
    node("e1", {}),
    node("e2", { role: "heading", name: "Danwo Shop", parent: "e1" }),
    node("e3", { role: "text", name: `Credits: ${credits}`, testId: "credits", parent: "e1" }),
    node("e4", {
      role: "button",
      name: buy,
      parent: "e1",
      box: { x: 0, y: 400, width: 600, height: 100 },
    }),
    node("e5", { role: "switch", name: "Gift", checked: false, parent: "e1" }),
    node("e6", { role: "textbox", name: "Note", editable: true, value: "", parent: "e1" }),
    node("e7", {
      role: "textbox",
      name: "PIN",
      editable: true,
      password: true,
      value: "1234",
      parent: "e1",
    }),
  ]
}

/** A device whose buy button adds 500 credits. */
class FakeDevice implements DeviceTarget {
  readonly platform = "android"
  readonly app = "com.danwo.shopmobile"
  readonly scheme = "danwoshop"
  buy = "Buy 500 credits"
  credits = 0
  screen: DeviceNode[] = home()
  readonly acts: string[] = []

  private draw() {
    this.screen = home(this.buy, this.credits)
  }

  async startApp() {
    this.credits = 0
    this.draw()

    return { relaunched: undefined }
  }

  async openLink(url: string) {
    this.acts.push(`link ${url}`)
  }

  async read() {
    return { nodes: this.screen }
  }

  async foreground(): Promise<DeviceForeground> {
    return { package: this.app, browser: false }
  }

  async tap(ref: string) {
    this.acts.push(`tap ${ref}`)

    if (ref === "e4") {
      this.credits += 500
      this.draw()
    }
  }

  async fill(ref: string, typed: string) {
    this.acts.push(`fill ${ref} ${typed}`)
  }

  async back() {
    this.acts.push("back")
  }

  async screenshot() {
    return false
  }
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function toolCall(toolName: string, input: unknown): LanguageModelV4GenerateResult {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${Math.random()}`,
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

/** Every string the model would read in its prompt. */
function promptText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(promptText).join("\n")
  if (value && typeof value === "object") return Object.values(value).map(promptText).join("\n")

  return ""
}

/** An actor that taps the button whose name starts with "Buy", then says it is done. */
function buyer(): MockLanguageModelV4 & { calls: number } {
  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "buyer",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      actor.calls++

      const tapped = options.prompt.some((message) => message.role === "tool")

      if (tapped) return toolCall("done", { status: "passed", summary: "bought" })

      const ref = /- button "Buy[^"]*" \[ref=(e\d+)\]/.exec(promptText(options.prompt))?.[1]

      return toolCall("tap", { ref })
    },
  })
  const actor = Object.assign(model, { calls: 0 })

  return actor
}

let dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dirs = []
})

async function cacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "danwo-device-cache-"))

  dirs.push(dir)

  return dir
}

async function open(
  device: FakeDevice,
  extra: Partial<Parameters<typeof openDeviceSession>[1]> = {},
): Promise<DeviceSession> {
  return openDeviceSession(device, {
    projectRoot: process.cwd(),
    actionTimeout: 300,
    assertionTimeout: 300,
    ...extra,
  })
}

describe("the device view", () => {
  it("reads like a page view: roles, names, states and refs, empty groups left out", () => {
    expect(treeText(home())).toBe(
      [
        '- heading "Danwo Shop" [ref=e2]',
        '- text "Credits: 0" [ref=e3]',
        '- button "Buy 500 credits" [ref=e4]',
        '- switch "Gift" [checked=false] [ref=e5]',
        '- textbox "Note" [ref=e6]',
        '- textbox "PIN" [ref=e7]: ••••',
      ].join("\n"),
    )
    expect(deviceRoute({ package: "x", browser: false })).toBe("app")
    expect(
      deviceRoute({
        package: "c",
        browser: true,
        url: "https://checkout.stripe.com/c/cs_test_a1B2c3D4e5",
      }),
    ).toBe("checkout.stripe.com/c/:id")
  })
})

describe("targets on a device", () => {
  it("describes an element by test id, else role and name, and finds it again", () => {
    const nodes = home()
    const [credits, buy] = [nodes[2], nodes[3]]

    expect(credits && describeNode(nodes, credits)).toEqual({ testId: "credits", role: "text" })
    expect(buy && describeNode(nodes, buy)).toEqual({ role: "button", name: "Buy 500 credits" })
    expect(findNode(nodes, { role: "button", name: "Buy 500 credits" }, false)).toMatchObject({
      node: { ref: "e4" },
    })
  })

  it("relocates a renamed element only when allowed and clear", () => {
    const renamed = home("Buy 500 credits now")
    const target = { role: "button", name: "Buy 500 credits" }

    expect(findNode(renamed, target, false)).toEqual({ missing: "matches nothing" })
    expect(findNode(renamed, target, true)).toMatchObject({
      node: { ref: "e4" },
      moved: { role: "button", name: "Buy 500 credits now" },
    })
    expect(findNode(home("Something else"), target, true)).toEqual({ missing: "matches nothing" })
  })

  it("parses tool calls and says what is wrong with a bad one", () => {
    expect(parseDeviceCall("tap", { ref: "e4" })).toEqual({
      call: { name: "tap", input: { ref: "e4" } },
    })
    expect(parseDeviceCall("scroll", { direction: "sideways" })).toMatchObject({
      problem: /direction/,
    })
    expect(parseDeviceCall("click", { ref: "e4" })).toEqual({ problem: 'there is no tool "click"' })
  })
})

describe("the agent on a device", () => {
  it("records a step with the model, then replays it with no model call", async () => {
    const dir = await cacheDir()
    const model = buyer()
    const first = new FakeDevice()
    const recording = await open(first, { model, cache: { dir, mode: "read-write" } })

    expect(await recording.agent.act("buy credits")).toMatchObject({ modelCalls: 2, actions: 1 })
    await recording.expect(recording.screen.getByTestId("credits")).toHaveText("Credits: 500")
    await recording.close()
    expect(await readdir(dir)).toHaveLength(1)

    const replaying = await open(new FakeDevice(), {
      model,
      cache: { dir, mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    expect(await replaying.agent.act("buy credits")).toMatchObject({ modelCalls: 0, actions: 1 })
    await replaying.expect(replaying.screen.getByTestId("credits")).toHaveText("Credits: 500")
    expect(model.calls).toBe(2)
    await replaying.close()
  })

  it("stops a strict replay whose button was renamed, and relocates it otherwise", async () => {
    const dir = await cacheDir()
    const model = buyer()
    const recording = await open(new FakeDevice(), { model, cache: { dir, mode: "read-write" } })

    await recording.agent.act("buy credits")
    await recording.expect(recording.screen.getByTestId("credits")).toHaveText("Credits: 500")
    await recording.close()

    const renamed = new FakeDevice()

    renamed.buy = "Buy 500 credits now"

    const strict = await open(renamed, {
      cache: { dir, mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    await strict.agent.act("buy credits")
    expect(strict.divergence()).toMatchObject({ step: 0, reason: /matches nothing/ })
    expect(await strict.agent.act("buy again")).toMatchObject({ modelCalls: 0, actions: 0 })

    const relocating = await open(renamed, { cache: { dir, mode: "read-only" } })

    expect(await relocating.agent.act("buy credits")).toMatchObject({ modelCalls: 0 })
    expect(model.calls).toBe(2)
  })

  it("stops a strict replay whose effects differ", async () => {
    const dir = await cacheDir()
    const recording = await open(new FakeDevice(), {
      model: buyer(),
      cache: { dir, mode: "read-write" },
    })

    await recording.agent.act("buy credits")
    await recording.expect(recording.screen.getByTestId("credits")).toHaveText("Credits: 500")
    await recording.close()

    /* The button no longer adds credits: every action replays, but the screen does not change. */
    const broken = new FakeDevice()

    broken.tap = async () => undefined

    const strict = await open(broken, {
      cache: { dir, mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    await strict.agent.act("buy credits")
    expect(strict.divergence()?.reason).toMatch(/^effect: /)
  })

  it("fails a strict replay with nothing recorded", async () => {
    const strict = await open(new FakeDevice(), {
      cache: { dir: await cacheDir(), mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    await expect(strict.agent.act("buy credits")).rejects.toMatchObject({
      code: "NOTHING_RECORDED",
    })
  })

  it("extracts by pointing at elements, and reads them again with no model", async () => {
    const dir = await cacheDir()
    let calls = 0
    const reader = new MockLanguageModelV4({
      provider: "mock",
      modelId: "reader",
      doGenerate: async () => {
        calls++

        return toolCall("read", { fields: [{ path: "credits", ref: "e3", as: "number" }] })
      },
    })
    const schema = z.object({ credits: z.number() })
    const first = await open(new FakeDevice(), {
      model: reader,
      cache: { dir, mode: "read-write" },
    })

    expect(await first.agent.extract("the credits", schema)).toEqual({ credits: 0 })

    const again = await open(new FakeDevice(), {
      cache: { dir, mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    expect(await again.agent.extract("the credits", schema)).toEqual({ credits: 0 })
    expect(calls).toBe(1)
  })

  it("judges claims and waits on the screen's text, recording the wait's evidence", async () => {
    const dir = await cacheDir()
    const prompts: string[] = []
    const judge = new MockLanguageModelV4({
      provider: "mock",
      modelId: "judge",
      doGenerate: async (options: LanguageModelV4CallOptions) => {
        prompts.push(promptText(options.prompt))

        return text({ verdict: "holds", reason: "the heading shows", evidence: "Danwo Shop" })
      },
    })
    const first = await open(new FakeDevice(), { model: judge, cache: { dir, mode: "read-write" } })

    await first.agent.assert("the shop is open")
    await first.agent.waitFor("the shop has loaded")
    expect(prompts[0]).toContain('- heading "Danwo Shop" [ref=e2]')
    expect(prompts[0]).not.toContain("1234")

    const again = await open(new FakeDevice(), {
      cache: { dir, mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    await again.agent.waitFor("the shop has loaded")
    expect(prompts).toHaveLength(2)
  })
})
