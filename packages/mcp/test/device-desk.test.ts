/**
 * A session's device desk on a scripted device: screens as node lists, taps and fills that change
 * them, and a driver whose handles last one reading only, as a real driver's do.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SecretVault } from "@danwo/runner"
import {
  createRedactor,
  type DeviceBox,
  type DeviceForeground,
  type DeviceNode,
  type DeviceScreenReading,
  type DeviceSwipe,
  type DeviceTarget,
  type LongPressOptions,
  type ScreenFilm,
} from "@danwo/runner/runner"
import { PNG } from "pngjs"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { deviceOnlyText, isDeviceOnly } from "../src/sessions/desk.ts"
import { DeviceDesk } from "../src/sessions/device.ts"

const SECRET = "card-pin-7d6c5b4a"
const WIDTH = 120
const HEIGHT = 240

/** An element of a scripted screen; its handle is given on each reading. */
type Element = Omit<DeviceNode, "ref" | "parent"> & { readonly id: string; readonly in?: string }

function element(
  id: string,
  role: string,
  name: string,
  box: DeviceBox,
  extra: Partial<Element> = {},
): Element {
  return {
    id,
    role,
    name,
    text: name,
    editable: false,
    password: false,
    enabled: true,
    box,
    ...extra,
  }
}

/** A device whose screen is a list of elements, and whose handles change with every reading. */
class ScriptedDevice implements DeviceTarget {
  readonly platform = "ios"
  readonly app = "com.danwo.pantry"
  readonly scheme = "pantry"
  screen: Element[] = []
  front: DeviceForeground = { package: "com.danwo.pantry", browser: false }
  readonly taps: string[] = []
  readonly fills: { id: string; text: string }[] = []
  readonly links: string[] = []
  readonly keys: string[] = []
  readonly gestures: string[] = []
  /** What a tap on an element does to the screen, by its id. */
  onTap: Record<string, () => void> = {}
  private reads = 0
  private handles = new Map<string, string>()

  startApp() {
    return Promise.resolve({ relaunched: undefined })
  }

  openLink(url: string) {
    this.links.push(url)

    return Promise.resolve()
  }

  read(): Promise<DeviceScreenReading> {
    this.reads += 1
    this.handles = new Map(this.screen.map((each) => [`r${this.reads}-${each.id}`, each.id]))

    const handleOf = (id: string) => `r${this.reads}-${id}`
    const nodes = this.screen.map(({ id, in: parent, ...rest }) => ({
      ...rest,
      ref: handleOf(id),
      ...(parent !== undefined && { parent: handleOf(parent) }),
    }))

    return Promise.resolve({ nodes })
  }

  foreground() {
    return Promise.resolve(this.front)
  }

  /** The element a handle of the latest reading names; a handle from an older one fails. */
  private resolve(ref: string): string {
    const id = this.handles.get(ref)

    if (id === undefined) throw new Error(`stale handle ${ref}`)

    return id
  }

  tap(ref: string) {
    const id = this.resolve(ref)

    this.taps.push(id)
    this.onTap[id]?.()

    return Promise.resolve()
  }

  fill(ref: string, text: string) {
    const id = this.resolve(ref)

    this.fills.push({ id, text })
    this.screen = this.screen.map((each) =>
      each.id === id ? { ...each, value: text, text } : each,
    )

    return Promise.resolve()
  }

  back() {
    this.keys.push("back")

    return Promise.resolve()
  }

  pressKey(key: string) {
    this.keys.push(key)

    return Promise.resolve()
  }

  swipe(swipe: DeviceSwipe) {
    const how = "direction" in swipe ? swipe.direction : "between points"
    const within = "within" in swipe && swipe.within !== undefined ? ` in y=${swipe.within.y}` : ""

    this.gestures.push(`swipe ${how}${within} ${swipe.durationMs ?? "quick"}`)

    return Promise.resolve()
  }

  longPress(ref: string, options: LongPressOptions = {}) {
    this.gestures.push(`long-press ${this.resolve(ref)} ${options.durationMs ?? "default"}`)

    return Promise.resolve()
  }

  dismissKeyboard() {
    this.gestures.push("dismiss keyboard")

    return Promise.resolve()
  }

  /** A white screen, the size of the boxes. */
  async screenshot(path: string) {
    const image = new PNG({ width: WIDTH, height: HEIGHT })

    image.data.fill(255)
    await writeFile(path, PNG.sync.write(image))

    return true
  }

  logs() {
    return Promise.resolve([
      {
        at: new Date().toISOString(),
        level: "error" as const,
        text: `payment failed for ${SECRET}`,
      },
      { at: new Date().toISOString(), level: "info" as const, text: "rendered" },
    ])
  }

  recordScreen(): Promise<ScreenFilm | undefined> {
    return Promise.resolve({ startedAt: Date.now(), stop: () => Promise.resolve(true) })
  }
}

/** The pantry's checkout screen: a list, a PIN field, a pay button. */
function checkout(device: ScriptedDevice): void {
  device.screen = [
    element("root", "generic", "", { x: 0, y: 0, width: WIDTH, height: HEIGHT }),
    element(
      "title",
      "heading",
      "Checkout",
      { x: 0, y: 0, width: WIDTH, height: 20 },
      { in: "root" },
    ),
    element("oats", "text", "Oats", { x: 0, y: 30, width: WIDTH, height: 20 }, { in: "root" }),
    element(
      "pin",
      "textbox",
      "PIN",
      { x: 10, y: 60, width: 100, height: 30 },
      { in: "root", editable: true, text: "", value: "", testId: "pin" },
    ),
    element("pay", "button", "Pay", { x: 10, y: 100, width: 100, height: 30 }, { in: "root" }),
    element(
      "terms",
      "switch",
      "Accept terms",
      { x: 10, y: 140, width: 100, height: 30 },
      { in: "root", checked: false },
    ),
  ]
}

describe("a device session's desk", () => {
  let device: ScriptedDevice
  let root: string
  let desk: DeviceDesk
  let first: string

  beforeEach(async () => {
    device = new ScriptedDevice()
    checkout(device)
    root = await mkdtemp(join(tmpdir(), "danwo-device-desk-"))

    const vault = new SecretVault({ cardPin: SECRET })
    const redactor = createRedactor(vault.redact)
    const opened = await DeviceDesk.open(
      {
        target: device,
        vault,
        redact: (text) => redactor.text(text),
        recordDir: { path: join(root, "recording"), shown: "recording/" },
      },
      "/",
    )

    desk = opened.desk
    first = opened.text
  })

  afterEach(async () => {
    await desk.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it("reads the screen as a tree with refs, and says what is in front", async () => {
    expect(first).toContain("device: iOS Simulator")
    expect(first).toContain("in front: the app com.danwo.pantry")
    expect(first).toMatch(/^- heading "Checkout" \[ref=e\d+\]$/m)
    expect(first).toMatch(/^- textbox "PIN" \[testId=pin\] \[ref=e\d+\]$/m)
    expect(first).toMatch(/^- switch "Accept terms" \[unchecked\] \[ref=e\d+\]$/m)
    /* An unnamed container gets no line of its own. */
    expect(first).not.toContain("generic")
    /* The app's log warnings and errors, redacted; its info lines are left out. */
    expect(first).toContain("app log error: payment failed for")
    expect(first).not.toContain(SECRET)
    expect(first).not.toContain("rendered")

    /* The same elements keep their refs from one reading to the next. */
    expect(await desk.snapshot()).toContain(refLine(first, "Pay"))
  })

  it("taps a ref with the driver's handle from a fresh reading", async () => {
    device.onTap.pay = () => {
      device.screen = [
        ...device.screen.filter((each) => each.id !== "pay"),
        element("done", "text", "Paid", { x: 0, y: 100, width: WIDTH, height: 20 }, { in: "root" }),
      ]
    }

    const answer = await desk.act({ kind: "click", target: refOf(first, "Pay") })

    expect(device.taps).toEqual(["pay"])
    expect(answer).toContain(`tapped ${refOf(first, "Pay")} (button "Pay")`)
    expect(answer).toContain("in front: the app com.danwo.pantry")
    expect(answer).toContain('- - button "Pay"')
    expect(answer).toMatch(/\+ - text "Paid" \[ref=e\d+\]/)
  })

  it("fills by a locator, and says what it filled", async () => {
    const answer = await desk.act({ kind: "fill", target: 'getByTestId("pin")', value: "1234" })

    expect(device.fills).toEqual([{ id: "pin", text: "1234" }])
    expect(answer).toContain('filled screen.getByTestId("pin")')
    expect(answer).toContain('textbox "PIN": "1234"')
  })

  it("fills a secret it never shows, and paints its field over in screenshots", async () => {
    const answer = await desk.act({
      kind: "fill_secret",
      target: 'getByTestId("pin")',
      secret: "cardPin",
    })

    expect(device.fills).toEqual([{ id: "pin", text: SECRET }])
    expect(answer).toContain('filled secret "cardPin"')
    expect(answer).not.toContain(SECRET)

    const shot = await desk.screenshot(undefined, false)
    const image = PNG.sync.read(Buffer.from(shot.image?.data ?? "", "base64"))
    const pixel = (x: number, y: number) => image.data[(y * image.width + x) * 4] ?? -1

    expect(shot.text).toContain("masked")
    /* Inside the PIN field: black. Inside the Pay button: the screen as it was. */
    expect(pixel(50, 75)).toBe(0)
    expect(pixel(50, 115)).toBe(255)

    /* A video cannot mask it, so none starts once a secret was filled. */
    await expect(desk.startRecording(true)).rejects.toThrow(/a secret was filled/)
  })

  it("refuses a browser's own tools, saying what this session drives", async () => {
    await expect(
      desk.act({ kind: "drag", target: refOf(first, "Oats"), to: refOf(first, "Pay") }),
    ).rejects.toThrow(/drag works on a browser page only, and this session drives an iOS Simulator/)
    await expect(desk.tabList()).rejects.toThrow(/tabs works on a browser page only/)
    await expect(
      desk.act({ kind: "click", target: refOf(first, "Pay"), double: true }),
    ).rejects.toThrow(/double clicks work on a browser page only/)
    expect(device.taps).toEqual([])
  })

  it("rechecks a ref before tapping: one that moved or went is refused with the screen now", async () => {
    const pay = refOf(first, "Pay")

    device.screen = device.screen.map((each) =>
      each.id === "pay" ? { ...each, box: { x: 10, y: 200, width: 100, height: 30 } } : each,
    )

    const moved = await desk.act({ kind: "click", target: pay }).catch((error: unknown) => error)

    expect(String(moved)).toContain(`${pay} (button "Pay") moved since the last snapshot`)
    expect(String(moved)).toContain("it was at 10,100 100×30, now at 10,200 100×30")
    expect(String(moved)).toContain("Nothing was done; the screen now:")
    expect(device.taps).toEqual([])

    /* The refusal showed the screen again: the ref now names the button where it is. */
    await desk.act({ kind: "click", target: pay })
    expect(device.taps).toEqual(["pay"])

    device.screen = device.screen.filter((each) => each.id !== "pay")

    await expect(desk.act({ kind: "click", target: pay })).rejects.toThrow(
      `${pay} (button "Pay") is no longer on the screen`,
    )
    expect(device.taps).toEqual(["pay"])
  })

  it("swipes, long-presses by a fresh handle and puts the keyboard away", async () => {
    const swiped = await desk.act({ kind: "swipe", direction: "left", durationMs: 700 })
    const inList = await desk.act({ kind: "swipe", direction: "up", target: refOf(first, "Oats") })
    const held = await desk.act({
      kind: "long_press",
      target: refOf(first, "Pay"),
      durationMs: 900,
    })
    const away = await desk.act({ kind: "dismiss_keyboard" })

    expect(device.gestures).toEqual([
      "swipe left 700",
      "swipe up in y=30 quick",
      "long-press pay 900",
      "dismiss keyboard",
    ])
    expect(swiped).toContain("swiped left over 700 ms")
    expect(inList).toContain(`swiped up across ${refOf(first, "Oats")} (text "Oats")`)
    expect(held).toContain(`long-pressed ${refOf(first, "Pay")} (button "Pay") for 900 ms`)
    expect(away).toContain("put the keyboard away")
  })

  it("leaves gestures to devices: a browser page refuses them", () => {
    for (const call of [
      { kind: "swipe", direction: "left" },
      { kind: "long_press", target: "e2" },
      { kind: "dismiss_keyboard" },
    ] as const)
      expect(isDeviceOnly(call)).toBe(true)
    expect(isDeviceOnly({ kind: "click", target: "e2" })).toBe(false)
    expect(deviceOnlyText("dismiss_keyboard")).toBe(
      "dismiss_keyboard is for a device session, and this session drives a browser page (a page has no on-screen keyboard)",
    )
  })

  it("shows the selected tab", async () => {
    device.screen = [
      ...device.screen,
      element("shop", "tab", "Shop", { x: 0, y: 200, width: 60, height: 40 }, { selected: true }),
    ]

    expect(await desk.snapshot()).toMatch(/^- tab "Shop" \[selected\] \[ref=e\d+\]$/m)
  })

  it("checks a switch by tapping it, and leaves one already in that state", async () => {
    device.onTap.terms = () => {
      device.screen = device.screen.map((each) =>
        each.id === "terms" ? { ...each, checked: true } : each,
      )
    }

    const terms = 'getByRole("switch", { name: "Accept terms" })'

    expect(await desk.act({ kind: "check", target: terms, checked: true })).toContain(
      "checked screen.getByRole",
    )
    expect(await desk.act({ kind: "check", target: terms, checked: true })).toContain(
      "is already checked",
    )
    expect(device.taps).toEqual(["terms"])
  })

  it("opens a path by the app's link scheme, and says when a browser comes in front", async () => {
    device.onTap.pay = () => {
      device.front = {
        package: "com.apple.SafariViewService",
        browser: true,
        url: "https://checkout.stripe.com/pay",
      }
    }

    await desk.act({ kind: "navigate", to: "/basket" })
    expect(device.links).toEqual(["pantry://basket"])

    const answer = await desk.act({ kind: "click", target: refOf(first, "Pay") })

    expect(answer).toContain(
      "in front: a browser the app opened (com.apple.SafariViewService) at https://checkout.stripe.com/pay (was the app com.danwo.pantry)",
    )
  })

  it("checks locators against the screen, with the chain a page takes", async () => {
    expect(await desk.check('getByRole("button", { name: "Pay" })')).toContain(
      'use in a test: screen.getByRole("button", { name: "Pay" })',
    )
    expect(await desk.check('getByRole("button", { name: "Pay now" })')).toContain(
      'nearest on the screen:\n  screen.getByRole("button", { name: "Pay" })',
    )
    expect(await desk.check('getByRole("text").filter({ hasText: "Oats" }).first()')).toContain(
      'matches exactly 1 element: text "Oats"',
    )
    await expect(desk.check('getByAltText("logo")')).rejects.toThrow(/no meaning on a device/)
  })
})

/** The line naming `name` in an answer, without its leading indent. */
function refLine(text: string, name: string): string {
  const line = text.split("\n").find((each) => each.includes(`"${name}"`) && each.includes("[ref="))

  return line?.trim() ?? `(no line for ${name})`
}

/** The ref an answer gives the element named `name`. */
function refOf(text: string, name: string): string {
  return /\[ref=(e\d+)\]/.exec(refLine(text, name))?.[1] ?? "e0"
}
