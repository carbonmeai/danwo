import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { type CheckPace, checkKey } from "../src/assert/pace.ts"
import { DeviceLocator } from "../src/device/locator.ts"
import { resolveChain, textMatches } from "../src/device/match.ts"
import { type DeviceSession, openDeviceSession } from "../src/device/session.ts"
import type { DeviceForeground, DeviceNode, DeviceTarget } from "../src/device/types.ts"
import type { Locator } from "../src/locate/types.ts"

/** A node with sensible defaults for what a test leaves out. */
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

/** The shop app's home screen, as the device driver reads it. */
const HOME: DeviceNode[] = [
  node("e1", {}),
  node("e2", { role: "heading", name: "Danwo Shop", parent: "e1" }),
  node("e3", { role: "text", name: "Credits: 0", testId: "credits", parent: "e1" }),
  node("e4", { role: "button", name: "Buy 500 credits", testId: "buy", parent: "e1" }),
  node("e5", { role: "text", name: "Buy 500 credits", parent: "e4" }),
  node("e6", { role: "switch", name: "Gift", checked: false, parent: "e1" }),
]

/** Checkout's web page in a Custom Tab: a label's text sits beside its unnamed field. */
const CHECKOUT: DeviceNode[] = [
  node("e1", { role: "document", name: "Checkout" }),
  node("e2", { role: "text", name: "Pay danwo", parent: "e1" }),
  node("e3", { parent: "e1" }),
  node("e4", { role: "text", name: "Email ", parent: "e3" }),
  node("e5", { role: "textbox", editable: true, value: "", text: "", parent: "e3" }),
  node("e6", { parent: "e1" }),
  node("e7", { role: "text", name: "Card number ", parent: "e6" }),
  node("e8", { role: "textbox", name: "4242 4242 4242 4242", parent: "e6" }),
  node("e9", {
    role: "textbox",
    name: "Password",
    editable: true,
    password: true,
    value: "",
    parent: "e1",
  }),
  node("e10", { role: "button", name: "Pay $5.00", parent: "e1" }),
  node("e11", { role: "button", name: "Back", parent: "e1" }),
]

/** A device whose screen a test sets, recording what is done to it. */
class FakeDevice implements DeviceTarget {
  readonly platform = "android"
  readonly app = "com.danwo.shopmobile"
  readonly scheme = "danwoshop"
  screen: DeviceNode[] = HOME
  readonly acts: string[] = []
  /** What a tap does to the screen, by ref. */
  readonly onTap = new Map<string, () => void>()

  /** A start the test can make need a second launch. */
  relaunch: string | undefined

  async startApp() {
    this.acts.push("start")
    this.screen = HOME

    return { relaunched: this.relaunch }
  }

  async openLink(url: string) {
    this.acts.push(`link ${url}`)
  }

  async read() {
    return { nodes: this.screen }
  }

  async foreground(): Promise<DeviceForeground> {
    return this.screen === CHECKOUT
      ? { package: "com.android.chrome", browser: true, url: "https://checkout.stripe.com/c/cs_1" }
      : { package: this.app, browser: false }
  }

  async tap(ref: string) {
    this.acts.push(`tap ${ref}`)
    this.onTap.get(ref)?.()
  }

  async fill(ref: string, text: string) {
    this.acts.push(`fill ${ref} ${text}`)
    this.screen = this.screen.map((each) =>
      each.ref === ref ? { ...each, value: text, text } : each,
    )
  }

  async back() {
    this.acts.push("back")
  }

  async pressKey(key: string) {
    this.acts.push(`key ${key}`)
  }

  async screenshot() {
    return false
  }

  async logs() {
    return [{ at: new Date().toISOString(), level: "info" as const, text: "ReactNativeJS: hello" }]
  }
}

let dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

async function open(
  device: FakeDevice,
  extra: { artifactsDir?: string; assertionTimeout?: number; checkPace?: CheckPace } = {},
): Promise<DeviceSession> {
  return openDeviceSession(device, {
    baseUrl: "http://127.0.0.1:1",
    projectRoot: process.cwd(),
    secrets: { password: { value: "hunter2" } },
    actionTimeout: 300,
    assertionTimeout: 300,
    ...extra,
  })
}

/** The chain a device locator resolves. */
function chain(locator: Locator) {
  if (!(locator instanceof DeviceLocator)) throw new TypeError("not a device locator")

  return locator.chain
}

function refs(nodes: readonly DeviceNode[]): string[] {
  return nodes.map((each) => each.ref)
}

describe("matching on a device's screen", () => {
  it("finds by test id, role and name, and the innermost text", async () => {
    const session = await open(new FakeDevice())
    const { screen } = session

    expect(refs(resolveChain(HOME, chain(screen.getByTestId("credits"))))).toEqual(["e3"])
    expect(
      refs(resolveChain(HOME, chain(screen.getByRole("button", { name: "buy 500" })))),
    ).toEqual(["e4"])
    expect(
      refs(resolveChain(HOME, chain(screen.getByRole("button", { name: "Buy", exact: true })))),
    ).toEqual([])
    expect(refs(resolveChain(HOME, chain(screen.getByRole("switch", { checked: false }))))).toEqual(
      ["e6"],
    )
    expect(
      refs(resolveChain(HOME, chain(screen.getByRole("heading", { disabled: true })))),
    ).toEqual([])
    /* The button and the text inside it carry the same words; getByText means the text. */
    expect(refs(resolveChain(HOME, chain(screen.getByText("Buy 500 credits"))))).toEqual(["e5"])
    expect(refs(resolveChain(HOME, chain(screen.getByText(/^Credits: \d+$/))))).toEqual(["e3"])
    expect(refs(resolveChain(HOME, chain(screen.getByTestId("buy").getByText("Buy"))))).toEqual([
      "e5",
    ])
  })

  it("labels a web page's field by the text just before it", async () => {
    const { screen } = await open(new FakeDevice())

    expect(refs(resolveChain(CHECKOUT, chain(screen.getByLabel("Email"))))).toEqual(["e5"])
    expect(refs(resolveChain(CHECKOUT, chain(screen.getByLabel("Password"))))).toEqual(["e9"])
    expect(
      refs(resolveChain(CHECKOUT, chain(screen.getByRole("textbox", { name: "Email" })))),
    ).toEqual(["e5"])
    expect(refs(resolveChain(CHECKOUT, chain(screen.getByLabel("Card number"))))).toEqual([])
    expect(refs(resolveChain(CHECKOUT, chain(screen.getByDisplayValue(""))))).toEqual(["e5", "e9"])
    expect(refs(resolveChain(CHECKOUT, chain(screen.getByPlaceholder("x"))))).toEqual([])
  })

  it("narrows with filter, first, last and nth", async () => {
    const { screen } = await open(new FakeDevice())
    const buttons = screen.getByRole("button")

    expect(refs(resolveChain(CHECKOUT, chain(buttons.filter({ hasText: "pay" }))))).toEqual(["e10"])
    expect(refs(resolveChain(CHECKOUT, chain(screen.getByText("Card number").first())))).toEqual([
      "e7",
    ])
    expect(refs(resolveChain(CHECKOUT, chain(buttons.last())))).toEqual(["e11"])
    expect(refs(resolveChain(CHECKOUT, chain(buttons.nth(0))))).toEqual(["e10"])
    expect(refs(resolveChain(CHECKOUT, chain(buttons.nth(5))))).toEqual([])
    expect(
      refs(
        resolveChain(
          HOME,
          chain(screen.getByRole("button").filter({ has: screen.getByText("Buy") })),
        ),
      ),
    ).toEqual(["e4"])
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a locator from somewhere else
    expect(() => buttons.filter({ has: {} as Locator })).toThrow("same device screen")
  })

  it("filters out elements by text or by what they hold", async () => {
    const { screen } = await open(new FakeDevice())
    const buttons = screen.getByRole("button")
    const all = refs(resolveChain(CHECKOUT, chain(buttons)))
    const paying = refs(resolveChain(CHECKOUT, chain(buttons.filter({ hasText: "pay" }))))

    expect(refs(resolveChain(CHECKOUT, chain(buttons.filter({ hasNotText: "pay" }))))).toEqual(
      all.filter((ref) => !paying.includes(ref)),
    )
    expect(
      refs(
        resolveChain(
          HOME,
          chain(screen.getByRole("button").filter({ hasNot: screen.getByText("Buy") })),
        ),
      ),
    ).not.toContain("e4")
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a locator from somewhere else
    expect(() => buttons.filter({ hasNot: {} as Locator })).toThrow("same device screen")
  })

  it("compares text as web locators do", () => {
    expect(textMatches("  Credits:   500 ", "credits: 500", false)).toBe(true)
    expect(textMatches("Credits: 500", "Credits", true)).toBe(false)
    expect(textMatches("Credits: 500", /500$/, false)).toBe(true)
  })
})

describe("acting on a device", () => {
  it("taps, fills and records each action as a step", async () => {
    const device = new FakeDevice()

    device.onTap.set("e4", () => {
      device.screen = CHECKOUT
    })

    const session = await open(device)
    const { screen } = session

    await screen.getByTestId("buy").tap()
    await screen.getByLabel("Email").fill("buyer@example.com")
    await screen.getByLabel("Password").fill(session.secret("password"))
    await screen.getByRole("button", { name: "Pay $5.00" }).click()

    expect(device.acts).toEqual([
      "start",
      "tap e4",
      "fill e5 buyer@example.com",
      "fill e9 hunter2",
      "tap e10",
    ])
    expect(await screen.getByLabel("Email").inputValue()).toBe("buyer@example.com")
    await expect(screen.getByLabel("Password").inputValue()).rejects.toThrow("password field")
    expect(session.flight.steps().map((step) => step.label)).toEqual([
      "com.danwo.shopmobile",
      'getByTestId("buy").click()',
      'getByLabel("Email").fill("buyer@example.com")',
      'getByLabel("Password").fill(secret "password")',
      'getByRole("button", name: "Pay $5.00").click()',
    ])
    await session.close()
  })

  it("checks and unchecks switches only when they need it", async () => {
    const device = new FakeDevice()
    const { screen } = await open(device)

    await screen.getByRole("switch").uncheck()
    await screen.getByRole("switch").check()
    expect(device.acts).toEqual(["start", "tap e6"])
    expect(await screen.getByRole("switch").isChecked()).toBe(false)
  })

  it("explains a locator that matches nothing or too much", async () => {
    const { screen } = await open(new FakeDevice())

    await expect(screen.getByTestId("missing").click()).rejects.toMatchObject({
      code: "LOCATOR_NOT_FOUND",
      message: 'locator.click: getByTestId("missing") matched nothing within 300 ms',
    })
    await expect(screen.getByRole("button", { name: "Nope" }).click()).rejects.toMatchObject({
      candidates: ['button "Buy 500 credits"'],
    })
    await expect(screen.getByText("Buy 500").click({ timeout: 50 })).resolves.toBeUndefined()
    await expect(screen.getByText(/Credits|Buy/).click({ timeout: 50 })).rejects.toMatchObject({
      code: "LOCATOR_AMBIGUOUS",
    })
    await expect(screen.getByTestId("credits").fill("x")).rejects.toThrow("is not a text field")
  })

  it("reads text, counts and state", async () => {
    const { screen } = await open(new FakeDevice())

    expect(await screen.getByTestId("buy").innerText()).toBe("Buy 500 credits Buy 500 credits")
    expect(await screen.getByTestId("credits").textContent()).toBe("Credits: 0")
    expect(await screen.getByText(/credits/i).count()).toBe(2)
    expect(await screen.getByText(/credits/i).allTextContents()).toEqual([
      "Credits: 0",
      "Buy 500 credits",
    ])
    expect(await screen.getByText(/credits/i).all()).toHaveLength(2)
    expect(await screen.getByTestId("buy").isVisible()).toBe(true)
    expect(await screen.getByTestId("gone").isHidden()).toBe(true)
    expect(await screen.getByTestId("buy").isEnabled()).toBe(true)
    expect(await screen.getByTestId("buy").isDisabled()).toBe(false)
    await screen.getByTestId("buy").waitFor()
    await screen.getByTestId("gone").waitFor({ state: "hidden" })
    await expect(screen.getByTestId("gone").waitFor({ timeout: 50 })).rejects.toMatchObject({
      code: "LOCATOR_NOT_READY",
    })
  })

  it("presses keys in a field and picks an option from a picker", async () => {
    const device = new FakeDevice()
    const { screen } = await open(device)
    const picker = [
      node("p1", { role: "text", name: "Large" }),
      node("p2", { role: "text", name: "Small" }),
    ]

    device.onTap.set("e4", () => {
      device.screen = [...HOME, ...picker]
    })
    await screen.getByTestId("buy").press("Enter")
    await screen.getByTestId("buy").selectOption("Small")
    expect(device.acts.slice(-4)).toEqual(["tap e4", "key Enter", "tap e4", "tap p2"])
    await expect(screen.getByTestId("buy").selectOption("Huge", { timeout: 50 })).rejects.toThrow(
      'shows no option "Huge"',
    )
  })

  it("says plainly what Android does not support yet", async () => {
    const session = await open(new FakeDevice())
    const buy = session.screen.getByTestId("buy")

    for (const call of [
      () => buy.hover(),
      () => buy.setInputFiles("a.png"),
      () => buy.dragTo(buy),
      () => session.mail.open("a@b.c"),
      () => session.browserState(),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "CONFIG_INVALID",
        message: expect.stringMatching(/not supported on devices yet/),
      })
    }
  })

  it("opens deep links through the app's scheme, and starts afresh without a path", async () => {
    const device = new FakeDevice()
    const session = await open(device)

    await session.app.open("/orders/7")
    await session.app.open()
    expect(device.acts).toEqual(["start", "link danwoshop://orders/7", "start"])
    expect(session.app.baseUrl).toBe("http://127.0.0.1:1")
    expect(session.platform).toBe("android")
  })
})

describe("expect on a device", () => {
  it("waits for text to change, and fails with what it saw", async () => {
    const device = new FakeDevice()
    const { screen, expect: check } = await open(device)

    setTimeout(() => {
      device.screen = HOME.map((each) =>
        each.ref === "e3" ? { ...each, name: "Credits: 500", text: "Credits: 500" } : each,
      )
    }, 100)
    await check(screen.getByTestId("credits")).toHaveText("Credits: 500")
    await check(screen.getByTestId("credits")).toContainText("500")
    await check(screen.getByTestId("buy")).toBeVisible()
    await check(screen.getByTestId("gone")).toBeHidden()
    await check(screen.getByTestId("gone")).not.toBeVisible()
    await check(screen.getByTestId("buy")).toBeEnabled()
    await check(screen.getByTestId("buy")).not.toBeDisabled()
    await check(screen.getByRole("switch")).not.toBeChecked()
    await check(screen.getByText(/credits/i)).toHaveCount(2)
    await expect(check(screen.getByTestId("credits")).toHaveText("Credits: 1000")).rejects.toThrow(
      'expect(getByTestId("credits")).toHaveText("Credits: 1000") failed after 300 ms\n  received: "Credits: 500"',
    )
    await check(screen.getByTestId("buy")).toHaveAttribute("data-testid", "buy")
    await check(screen.getByTestId("buy")).toHaveAttribute("aria-label", /buy 500/i)
    await check(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false")
    await check(screen.getByTestId("buy")).not.toHaveAttribute("href")
    expect(await screen.getByTestId("credits").getAttribute("aria-label")).toBe("Credits: 500")
    expect(await screen.getByTestId("credits").getAttribute("href")).toBeNull()
    check(1 + 1).toBe(2)
  })

  it("waits for a check about as long as it took in the paced run", async () => {
    const device = new FakeDevice()
    const label = 'getByTestId("credits") toHaveText("Credits: 1000")'
    /* Step 0 is the app's start; the check is step 1. */
    const { screen, expect: check } = await open(device, {
      assertionTimeout: 10_000,
      checkPace: { took: { [checkKey(1, "expect.toHaveText", label)]: 50 }, floorMs: 100 },
    })

    await expect(check(screen.getByTestId("credits")).toHaveText("Credits: 1000")).rejects.toThrow(
      "failed after 650 ms",
    )
  })

  it("checks a field's value", async () => {
    const device = new FakeDevice()
    const { screen, expect: check } = await open(device)

    device.screen = CHECKOUT
    await screen.getByLabel("Email").fill("a@b.c")
    await check(screen.getByLabel("Email")).toHaveValue("a@b.c")
    expect(device.acts).toContain("fill e5 a@b.c")
  })
})

describe("a device attempt's flight record", () => {
  it("keeps the device log, and the screen and what was in front when it failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-device-flight-"))

    dirs.push(dir)

    const device = new FakeDevice()

    device.onTap.set("e4", () => {
      device.screen = CHECKOUT
    })

    const session = await open(device, { artifactsDir: dir })

    await session.screen.getByTestId("buy").click()

    const error = await session.screen
      .getByTestId("missing")
      .click()
      .catch((caught: unknown) => caught)
    const evidence = await session.flight.captureFailure(error)

    expect(evidence).toMatchObject({
      url: "https://checkout.stripe.com/c/cs_1",
      screen: "screen-at-failure.txt",
    })
    expect(await readFile(join(dir, "screen-at-failure.txt"), "utf8")).toContain(
      'browser com.android.chrome https://checkout.stripe.com/c/cs_1\n- document "Checkout"\n  - text "Pay danwo"',
    )
    expect(session.flight.appLog().map((line) => line.source)).toContain("device-log")
    expect(session.flight.screenshots().size).toBe(0)
    expect(session.flight.redact("hunter2")).not.toContain("hunter2")
    await session.close()

    const relaunched = new FakeDevice()

    relaunched.relaunch = "not in front; stopped and launched again"

    const again = await open(relaunched)

    expect(again.flight.appLog().map((line) => line.text)).toContain(
      "danwo: com.danwo.shopmobile not in front; stopped and launched again",
    )
    await session.close()
  })
})

describe("secrets on a device", () => {
  it("never show a secret's value in a step", async () => {
    const device = new FakeDevice()
    const session = await open(device)

    device.screen = CHECKOUT
    await session.screen.getByLabel("Password").fill(session.secret("password"))
    expect(JSON.stringify(session.flight.steps())).not.toContain("hunter2")
  })
})
