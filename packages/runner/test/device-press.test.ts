/**
 * Pressing safely on a device: an element is found again on the latest screen before it is
 * pressed (its ref from that reading, once it is in place), an action waits for it to be enabled,
 * the selected state reaches locators and the agent, a locator can long-press, and the agent can
 * long-press, swipe and put the keyboard away, in a live step and in its replay.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterEach, describe, expect, it } from "vitest"

import { treeText } from "../src/device/agent/view.ts"
import { findAgain } from "../src/device/current.ts"
import { type DeviceSession, openDeviceSession } from "../src/device/session.ts"
import type {
  DeviceBox,
  DeviceForeground,
  DeviceNode,
  DeviceSwipe,
  DeviceTarget,
  LongPressOptions,
} from "../src/device/types.ts"

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

function box(y: number): DeviceBox {
  return { x: 0, y, width: 600, height: 100 }
}

/** A screen with a Buy button at `y`, after `before` elements, and two tabs (Shop selected). */
function screenWith(options: { y?: number; enabled?: boolean; banner?: boolean } = {}) {
  const banner = options.banner === true ? [node("e2", { role: "text", name: "Sale today" })] : []
  const at = banner.length + 2
  const ref = (offset: number) => `e${at + offset}`

  return [
    node("e1", {}),
    ...banner,
    node(ref(0), {
      role: "button",
      name: "Buy",
      testId: "buy",
      enabled: options.enabled ?? true,
      box: box(options.y ?? 400),
      parent: "e1",
    }),
    node(ref(1), { role: "tab", name: "Shop", selected: true, box: box(1800), parent: "e1" }),
    node(ref(2), { role: "tab", name: "Orders", selected: false, box: box(1900), parent: "e1" }),
    node(ref(3), { role: "textbox", name: "Note", editable: true, value: "", parent: "e1" }),
  ]
}

/** A device whose readings a test lines up: each read takes the next, the last one stays. */
class ScriptedDevice implements DeviceTarget {
  readonly platform = "android"
  readonly app = "com.danwo.shopmobile"
  readonly scheme = "danwoshop"
  readonly acts: string[] = []
  private readings: DeviceNode[][]

  constructor(...readings: DeviceNode[][]) {
    this.readings = readings.length === 0 ? [screenWith()] : readings
  }

  /** The screen from the next reading on. */
  show(...readings: DeviceNode[][]) {
    this.readings = readings
  }

  async startApp() {
    return { relaunched: undefined }
  }

  async openLink(url: string) {
    this.acts.push(`link ${url}`)
  }

  async read() {
    const [next, ...rest] = this.readings

    if (rest.length > 0) this.readings = rest

    return { nodes: next ?? [] }
  }

  async foreground(): Promise<DeviceForeground> {
    return { package: this.app, browser: false }
  }

  async tap(ref: string) {
    this.acts.push(`tap ${ref}`)
  }

  async fill(ref: string, text: string) {
    this.acts.push(`fill ${ref} ${text}`)
  }

  async back() {
    this.acts.push("back")
  }

  async swipe(swipe: DeviceSwipe) {
    const how = "direction" in swipe ? swipe.direction : "points"
    const within = "within" in swipe && swipe.within !== undefined ? ` in ${swipe.within.y}` : ""

    this.acts.push(`swipe ${how}${within} ${swipe.durationMs ?? "-"}`)
  }

  async longPress(ref: string, options: LongPressOptions = {}) {
    this.acts.push(`long-press ${ref} ${options.durationMs ?? "-"}`)
  }

  async dismissKeyboard() {
    this.acts.push("dismiss keyboard")
  }

  async screenshot() {
    return false
  }
}

let dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

function open(
  device: DeviceTarget,
  extra: Partial<Parameters<typeof openDeviceSession>[1]> = {},
): Promise<DeviceSession> {
  return openDeviceSession(device, {
    projectRoot: process.cwd(),
    actionTimeout: 600,
    assertionTimeout: 600,
    ...extra,
  })
}

describe("a locator's action on a device", () => {
  it("waits for a disabled element to be enabled before it taps", async () => {
    const device = new ScriptedDevice(screenWith({ enabled: false }))
    const { screen } = await open(device)

    setTimeout(() => device.show(screenWith()), 200)
    await screen.getByTestId("buy").tap()
    expect(device.acts).toEqual(["tap e2"])
  })

  it("fails an element that stays disabled, saying so", async () => {
    const device = new ScriptedDevice(screenWith({ enabled: false }))
    const { screen } = await open(device)

    await expect(screen.getByTestId("buy").tap()).rejects.toMatchObject({
      code: "LOCATOR_NOT_READY",
      message: 'locator.click: getByTestId("buy") is disabled',
    })
    expect(device.acts).toEqual([])
  })

  it("taps by the latest reading's ref when the refs moved on between readings", async () => {
    /* The first reading finds Buy as e2; a banner then shows, and the driver numbers it e3. */
    const device = new ScriptedDevice(screenWith(), screenWith({ banner: true }))
    const { screen } = await open(device)

    await screen.getByTestId("buy").tap()
    expect(device.acts).toEqual(["tap e3"])
  })

  it("waits for an element that moved until two readings agree on where it is", async () => {
    /* The keyboard slides the form up: Buy is at 400, then 300, then stays at 300. */
    const device = new ScriptedDevice(
      screenWith({ y: 400 }),
      screenWith({ y: 300, banner: true }),
      screenWith({ y: 300, banner: true }),
    )
    const { screen } = await open(device)

    await screen.getByTestId("buy").tap()
    expect(device.acts).toEqual(["tap e3"])
  })

  it("looks for an element again when it left the screen between readings", async () => {
    const device = new ScriptedDevice(screenWith(), [node("e1", {})], screenWith({ banner: true }))
    const { screen } = await open(device)

    await screen.getByTestId("buy").tap()
    expect(device.acts).toEqual(["tap e3"])
  })

  it("finds the same element of several alike by where it was", () => {
    const earlier = node("e4", { role: "button", name: "Add", box: box(500) })
    const rows = [
      node("e7", { role: "button", name: "Add", box: box(200) }),
      node("e8", { role: "button", name: "Add", box: box(520) }),
      node("e9", { role: "button", name: "Remove", box: box(500) }),
    ]

    expect(findAgain(rows, earlier)?.ref).toBe("e8")
    expect(findAgain(rows, node("e4", { role: "button", name: "Buy" }))).toBeUndefined()
  })
})

describe("a locator's long press on a device", () => {
  it("waits for the element to be enabled, then holds it by the latest reading's ref", async () => {
    /* Buy starts disabled as e2; once enabled, a banner shows and Buy is e3. */
    const device = new ScriptedDevice(screenWith({ enabled: false }))
    const session = await open(device)

    setTimeout(() => device.show(screenWith({ banner: true })), 200)
    await session.screen.getByTestId("buy").longPress({ durationMs: 1_200 })
    await session.screen.getByTestId("buy").longPress()
    expect(device.acts).toEqual(["long-press e3 1200", "long-press e3 -"])
    expect(session.flight.steps().map((step) => [step.api, step.label])).toEqual(
      expect.arrayContaining([
        ["locator.longPress", 'getByTestId("buy").longPress(durationMs: 1200)'],
        ["locator.longPress", 'getByTestId("buy").longPress()'],
      ]),
    )
  })

  it("fails an element that stays disabled, without pressing it", async () => {
    const device = new ScriptedDevice(screenWith({ enabled: false }))
    const { screen } = await open(device)

    await expect(screen.getByTestId("buy").longPress()).rejects.toMatchObject({
      code: "LOCATOR_NOT_READY",
      message: 'locator.longPress: getByTestId("buy") is disabled',
    })
    expect(device.acts).toEqual([])
  })

  it("says so on a device that cannot long-press", async () => {
    const device = new ScriptedDevice()
    const { screen } = await open(Object.assign(device, { longPress: undefined }))

    await expect(screen.getByTestId("buy").longPress()).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: "locator.longPress is not supported on devices yet",
    })
  })
})

describe("the selected state on a device", () => {
  it("reaches locators and attributes", async () => {
    const { screen, expect: check } = await open(new ScriptedDevice())

    expect(await screen.getByRole("tab", { selected: true }).innerText()).toBe("Shop")
    expect(await screen.getByRole("tab", { selected: false }).innerText()).toBe("Orders")
    await check(screen.getByRole("tab", { name: "Shop" })).toHaveAttribute("aria-selected", "true")
    await check(screen.getByRole("tab", { name: "Orders" })).toHaveAttribute(
      "aria-selected",
      "false",
    )
  })

  it("shows in the agent's view of the screen", () => {
    const view = treeText(screenWith())

    expect(view).toContain('- tab "Shop" [selected] [ref=e3]')
    expect(view).toContain('- tab "Orders" [ref=e4]')
  })
})

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

/** A model that makes these calls in turn, then says the step is done; `thinking` runs first. */
function scripted(
  calls: readonly (readonly [string, unknown])[],
  thinking: () => void = () => undefined,
): MockLanguageModelV4 {
  let next = 0

  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "scripted",
    doGenerate: async () => {
      thinking()

      const [name, input] = calls[next++] ?? ["done", { status: "passed", summary: "done" }]

      return toolCall(name, input)
    },
  })
}

describe("the agent's gestures on a device", () => {
  it("long-presses, swipes and puts the keyboard away, then replays them with no model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-device-gestures-"))

    dirs.push(dir)

    const model = scripted([
      ["long_press", { ref: "e2", duration_ms: 1_200 }],
      ["swipe", { direction: "left", ref: "e3", duration_ms: 700 }],
      ["swipe", { direction: "down" }],
      ["dismiss_keyboard", {}],
    ])
    const live = new ScriptedDevice()
    const recording = await open(live, { model, cache: { dir, mode: "read-write" } })

    expect(await recording.agent.act("open the menu, turn the page and refresh")).toMatchObject({
      actions: 4,
    })
    expect(live.acts).toEqual([
      "long-press e2 1200",
      "swipe left in 1800 700",
      "swipe down -",
      "dismiss keyboard",
    ])
    /* A check after the step confirms it, so its recording is kept. */
    await recording.expect(recording.screen.getByTestId("buy")).toBeVisible()
    await recording.close()

    const replayed = new ScriptedDevice()
    const replaying = await open(replayed, {
      cache: { dir, mode: "read-only" },
      replay: { mode: "strict-stop" },
    })

    expect(await replaying.agent.act("open the menu, turn the page and refresh")).toMatchObject({
      modelCalls: 0,
      actions: 4,
    })
    expect(replayed.acts).toEqual(live.acts)
  })

  it("taps by the latest ref when the screen changed after the view the model read", async () => {
    const device = new ScriptedDevice(screenWith())
    /* The model's view had Buy as e2; while it thinks, a banner shows and Buy becomes e3. */
    const model = scripted([["tap", { ref: "e2" }]], () =>
      device.show(screenWith({ banner: true })),
    )
    const session = await open(device, { model })

    await session.agent.act("buy")
    expect(device.acts).toEqual(["tap e3"])
  })
})
