import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"

import type { Exchange } from "@danwo/proxy"
import { afterEach, describe, expect, it } from "vitest"

import {
  type DeviceDriver,
  deviceNodes,
  type DriverNode,
  type Exec,
  IosBinder,
  iosDevice,
  iosWorkers,
  roleOf,
  Simctl,
  SimulatorTool,
  useSimulator,
  withIosDevice,
} from "../src/index.ts"
import { childEnv, IosApp, parseLogLine } from "../src/ios/app.ts"
import { withoutLoopbackProxy } from "../src/ios/binder.ts"
import { sameNode } from "../src/ios/device.ts"
import { iosDoctor } from "../src/ios/doctor.ts"
import {
  type ProxySettings,
  proxiedSettings,
  proxiesThrough,
  simulatorTarget,
} from "../src/ios/proxy-helper.ts"
import { pickDeviceType, pickRuntime, simulatorName } from "../src/ios/simulator.ts"
import { browserShowing, iosNodes } from "../src/ios/tree.ts"

const UDID = "11111111-2222-3333-4444-555555555555"
const RUNTIMES = {
  runtimes: [
    {
      identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-6",
      name: "iOS 18.6",
      version: "18.6",
      platform: "iOS",
      isAvailable: true,
      supportedDeviceTypes: [
        { name: "iPhone 16 Pro", identifier: "iPhone-16-Pro", productFamily: "iPhone" },
      ],
    },
    {
      identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
      name: "iOS 26.5",
      version: "26.5",
      platform: "iOS",
      isAvailable: true,
      supportedDeviceTypes: [
        { name: "iPhone 11 Pro", identifier: "iPhone-11-Pro", productFamily: "iPhone" },
        { name: "iPhone 17 Pro Max", identifier: "iPhone-17-Pro-Max", productFamily: "iPhone" },
        { name: "iPhone 17 Pro", identifier: "iPhone-17-Pro", productFamily: "iPhone" },
        { name: "iPhone 17", identifier: "iPhone-17", productFamily: "iPhone" },
        { name: "iPad Pro 13-inch (M5)", identifier: "iPad-Pro", productFamily: "iPad" },
      ],
    },
    {
      identifier: "com.apple.CoreSimulator.SimRuntime.tvOS-18-5",
      name: "tvOS 18.5",
      version: "18.5",
      platform: "tvOS",
      isAvailable: true,
    },
  ],
}

/** The simulators `simctl list devices` reports, by runtime. */
function deviceListing(devices: readonly { name: string; state: string; udid?: string }[]) {
  return {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-26-5": devices.map((each) => ({
        udid: each.udid ?? UDID,
        name: each.name,
        state: each.state,
        isAvailable: true,
        deviceTypeIdentifier: "iPhone-17-Pro",
      })),
    },
  }
}

/** A command as the fakes record it: `simctl`'s without the `xcrun simctl` in front. */
function commandOf(file: string, args: readonly string[]): string {
  return file === "xcrun" && args[0] === "simctl"
    ? args.slice(1).join(" ")
    : `${file} ${args.join(" ")}`
}

/** The answer whose key the command contains, or nothing. */
function answerTo(answers: Readonly<Record<string, string>>, command: string): string {
  const key = Object.keys(answers).find((each) => command.includes(each))

  return key === undefined ? "" : (answers[key] ?? "")
}

/** A proxy entry the helper was given, as JSON. */
function parsedSettings(json: string): ProxySettings {
  const written: unknown = JSON.parse(json)

  return typeof written === "object" && written !== null ? { ...written } : {}
}

/**
 * An `Exec` that records every command (`xcrun simctl …` without the `xcrun simctl`) and answers
 * from `answers` by the command's text; the proxy helper's entry is kept like the simulator's store.
 */
function fakeXcrun(answers: Readonly<Record<string, string>> = {}) {
  const commands: string[] = []
  const envs: Record<string, string>[] = []
  let store: ProxySettings = { ExceptionsList: ["*.local"], FTPPassive: 1 }

  /* The helper's `set` replaces the entry; `get` and `set` both print it. */
  const helper = (command: string): string | undefined => {
    const at = command.indexOf("danwo-sim-proxy set ")

    if (at !== -1) store = parsedSettings(command.slice(at + "danwo-sim-proxy set ".length))

    return command.includes("danwo-sim-proxy ") ? JSON.stringify(store) : undefined
  }

  const exec: Exec = async (file, args, options) => {
    const command = commandOf(file, args)

    commands.push(command)
    if (options?.env !== undefined) envs.push({ ...options.env })

    return helper(command) ?? answerTo(answers, command)
  }

  return { commands, envs, exec, store: () => store }
}

describe("picking a simulator", () => {
  it("numbers the name from the second worker on", () => {
    expect(simulatorName({})).toBe("danwo iPhone")
    expect(simulatorName({ worker: 0 })).toBe("danwo iPhone")
    expect(simulatorName({ name: "shop", worker: 2 })).toBe("shop 3")
  })

  it("takes the newest iOS runtime, or the one asked for by name, version or identifier", () => {
    expect(pickRuntime(RUNTIMES.runtimes, undefined).name).toBe("iOS 26.5")
    expect(pickRuntime(RUNTIMES.runtimes, "18.6").name).toBe("iOS 18.6")
    expect(pickRuntime(RUNTIMES.runtimes, "iOS 18.6").version).toBe("18.6")
    expect(() => pickRuntime(RUNTIMES.runtimes, "17.0")).toThrow("installed: iOS 26.5, iOS 18.6")
    expect(() => pickRuntime([], undefined)).toThrow("no iOS Simulator runtime is installed")
  })

  it("takes the runtime's newest iPhone Pro, whatever order the listing has", () => {
    const [, newest] = RUNTIMES.runtimes

    expect(pickDeviceType(newest ?? RUNTIMES.runtimes[0]!, undefined).name).toBe("iPhone 17 Pro")
    expect(pickDeviceType(newest ?? RUNTIMES.runtimes[0]!, "iPhone 17").identifier).toBe(
      "iPhone-17",
    )
    expect(() => pickDeviceType(newest ?? RUNTIMES.runtimes[0]!, "Pixel 9")).toThrow(
      'cannot run a "Pixel 9" simulator',
    )
  })

  it("creates danwo's simulator when there is none, boots it, and keeps it on close", async () => {
    const { commands, exec } = fakeXcrun({
      "list devices": JSON.stringify(deviceListing([])),
      "list runtimes": JSON.stringify(RUNTIMES),
      "list devicetypes": JSON.stringify({ devicetypes: [] }),
      create: `${UDID}\n`,
    })
    const simulator = await useSimulator({ bootTimeoutMs: 1_000 }, exec)

    expect(simulator).toMatchObject({ name: "danwo iPhone", created: true, booted: true, scale: 3 })
    expect(commands).toContain(
      "create danwo iPhone iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-26-5",
    )
    expect(commands).toContain(`boot ${UDID}`)
    expect(commands).toContain(`bootstatus ${UDID} -b`)

    await simulator.stop()
    expect(commands.at(-1)).toBe(`shutdown ${UDID}`)
  })

  it("leaves a simulator that was already running as it was, and deletes one it made when asked", async () => {
    const running = fakeXcrun({
      "list devices": JSON.stringify(deviceListing([{ name: "danwo iPhone 2", state: "Booted" }])),
    })
    const found = await useSimulator({ worker: 1 }, running.exec)

    expect(found).toMatchObject({ created: false, booted: false })
    await found.stop()
    expect(running.commands.some((command) => command.startsWith("boot "))).toBe(false)
    expect(running.commands.some((command) => command.startsWith("shutdown"))).toBe(false)

    const fresh = fakeXcrun({
      "list devices": JSON.stringify(deviceListing([])),
      "list runtimes": JSON.stringify(RUNTIMES),
      create: UDID,
    })
    const made = await useSimulator({ remove: true }, fresh.exec)

    await made.stop()
    expect(fresh.commands.slice(-2)).toEqual([`shutdown ${UDID}`, `delete ${UDID}`])
  })

  it("names an unknown udid", async () => {
    const { exec } = fakeXcrun({ "list devices": JSON.stringify(deviceListing([])) })

    await expect(useSimulator({ udid: "nope" }, exec)).rejects.toThrow(
      "no simulator has the udid nope",
    )
  })

  it("fits as many simulators as half the memory and a pair of cores each allow", () => {
    expect(iosWorkers({ machine: { memoryMb: 32_768, cores: 10, load: 1 } })).toBe(3)
    expect(iosWorkers({ machine: { memoryMb: 8_192, cores: 10, load: 1 } })).toBe(2)
    expect(iosWorkers({ machine: { memoryMb: 32_768, cores: 10, load: 12 } })).toBe(1)
  })
})

describe("the simulator's proxy", () => {
  it("sends HTTP and HTTPS through the proxy, keeping the rest and dropping per-interface copies", () => {
    const settings = proxiedSettings(
      { ExceptionsList: ["*.local"], FTPPassive: 1, __SCOPED__: { en0: {} } },
      "127.0.0.1",
      8002,
    )

    expect(settings).toEqual({
      ExceptionsList: ["*.local"],
      FTPPassive: 1,
      HTTPEnable: 1,
      HTTPProxy: "127.0.0.1",
      HTTPPort: 8002,
      HTTPSEnable: 1,
      HTTPSProxy: "127.0.0.1",
      HTTPSPort: 8002,
    })
    expect(proxiesThrough(settings, "127.0.0.1", 8002)).toBe(true)
    expect(proxiesThrough(settings, "127.0.0.1", 8003)).toBe(false)
  })

  it("never goes back to a loopback proxy a run left behind", () => {
    const stale = proxiedSettings({ FTPPassive: 1 }, "127.0.0.1", 9000)
    const company = { HTTPSEnable: 1, HTTPSProxy: "proxy.example.com", HTTPSPort: 3128 }

    expect(withoutLoopbackProxy(stale)).toEqual({ FTPPassive: 1 })
    expect(withoutLoopbackProxy(company)).toBe(company)
  })

  it("is built for this Mac's CPU", () => {
    expect(simulatorTarget("arm64")).toBe("arm64-apple-ios15.0-simulator")
    expect(simulatorTarget("x64")).toBe("x86_64-apple-ios15.0-simulator")
  })
})

/** A simulator tool for `UDID` over `exec`, and its proxy through the helper at `/helper/danwo-sim-proxy`. */
async function binderFor(exec: Exec, proxyPort = 8002) {
  const { SimulatorProxy } = await import("../src/ios/proxy-helper.ts")
  const tool = new SimulatorTool(new Simctl(exec), UDID)

  return new IosBinder(tool, new SimulatorProxy(tool, "/helper/danwo-sim-proxy"), {
    caCert: "-----BEGIN CERTIFICATE-----\n",
    proxyPort,
  })
}

/** A simulator store that keeps its entry whatever is written. */
const stubbornStore: Exec = async (_file, args) =>
  args.join(" ").includes("danwo-sim-proxy") ? JSON.stringify({ FTPPassive: 1 }) : ""

describe("the iOS binder", () => {
  it("trusts the CA, points the simulator's proxy at danwo's, and puts the old setting back", async () => {
    const fake = fakeXcrun()
    const binder = await binderFor(fake.exec)

    await binder.bind()

    expect(fake.commands[0]).toMatch(
      new RegExp(`^keychain ${UDID} add-root-cert .*danwo-ca\\.pem$`),
    )
    expect(fake.commands[1]).toBe(`spawn ${UDID} /helper/danwo-sim-proxy get`)
    expect(fake.store()).toMatchObject({ HTTPSProxy: "127.0.0.1", HTTPSPort: 8002, FTPPassive: 1 })

    await binder.unbind()
    expect(fake.store()).toEqual({ ExceptionsList: ["*.local"], FTPPassive: 1 })
  })

  it("writes the proxy again only when the simulator lost it", async () => {
    const fake = fakeXcrun()
    const binder = await binderFor(fake.exec)

    await binder.bind()

    const writes = () => fake.commands.filter((command) => command.includes(" set ")).length

    await binder.ensure()
    expect(writes()).toBe(1)
  })

  it("says so when the simulator does not take the setting", async () => {
    const binder = await binderFor(stubbornStore)

    await expect(binder.bind()).rejects.toThrow(
      `the simulator ${UDID} did not take the proxy setting`,
    )
  })
})

/** The `index`th node, which the test's own tree has. */
function nth(nodes: readonly DriverNode[], index: number): DriverNode {
  const node = nodes[index]

  if (node === undefined) throw new Error(`no node ${index}`)

  return node
}

describe("the simulator's accessibility tree", () => {
  const nodes: DriverNode[] = [
    {
      index: 0,
      type: "Application",
      label: "Danwo Shop",
      rect: { x: 0, y: 0, width: 402, height: 874 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: "StaticText",
      label: "Credits: 500",
      identifier: "credits",
      hittable: true,
    },
    { index: 2, parentIndex: 1, type: "StaticText", label: "Credits: 500", hittable: true },
    {
      index: 3,
      parentIndex: 0,
      type: "Button",
      label: "Buy 500 credits",
      identifier: "buy",
      rect: { x: 10, y: 20, width: 100, height: 40 },
    },
    {
      index: 4,
      parentIndex: 0,
      type: "TextField",
      label: "Email",
      placeholder: "you@example.com",
      value: "you@example.com",
    },
    { index: 5, parentIndex: 0, type: "SecureTextField", label: "Password", value: "••••" },
    { index: 6, parentIndex: 0, type: "Other", label: "Checkout", hittable: true },
    { index: 7, parentIndex: 0, type: "Link", label: "Back" },
  ]

  it("counts React Native's doubled text once, scales boxes to pixels and fills in text entry", () => {
    const mapped = deviceNodes(iosNodes(nodes, 3))

    expect(mapped.map((node) => `${node.role} ${node.name}`)).toEqual([
      "generic Danwo Shop",
      "text Credits: 500",
      "button Buy 500 credits",
      "textbox Email",
      "textbox Password",
      "generic Checkout",
      "link Back",
    ])
    expect(mapped.find((node) => node.testId === "buy")?.box).toEqual({
      x: 30,
      y: 60,
      width: 300,
      height: 120,
    })
    expect(mapped.find((node) => node.name === "Email")).toMatchObject({
      editable: true,
      value: "",
    })
    expect(mapped.find((node) => node.name === "Password")).toMatchObject({ password: true })
  })

  it("names iOS roles by element type, and a plain tappable view is no button", () => {
    expect(roleOf({ index: 0, type: "Switch" })).toBe("switch")
    expect(roleOf({ index: 0, type: "WebView" })).toBe("document")
    expect(roleOf({ index: 0, type: "Other", hittable: true, label: "Pay" })).toBe("generic")
    expect(roleOf({ index: 0, type: "Other", kind: "button" })).toBe("button")
  })

  it("tells a browser over the app by its own controls", () => {
    expect(browserShowing(nodes)).toBe(false)
    expect(
      browserShowing([...nodes, { index: 9, type: "Other", identifier: "TopBrowserBar" }]),
    ).toBe(true)
    expect(browserShowing([{ index: 0, type: "Application", label: "Safari" }])).toBe(true)
  })

  it("finds an element again in a new reading by its type, label and id", () => {
    const [buy, back] = [nth(nodes, 3), nth(nodes, 7)]
    const later: DriverNode[] = [{ ...buy, index: 9, ref: "e10" }]

    expect(sameNode(later, buy)?.ref).toBe("e10")
    expect(sameNode(later, back)).toBeUndefined()
  })
})

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

/** A data container like the simulator's: metadata, the app's own files, and its folders. */
async function container(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "danwo-container-"))
  await writeFile(join(dir, ".com.apple.mobile_container_manager.metadata.plist"), "meta")
  await mkdir(join(dir, "Library", "Application Support"), { recursive: true })
  await writeFile(join(dir, "Library", "Application Support", "db.sqlite"), "data")

  return dir
}

/** A child process with an output stream that never runs anything. */
function fakeChild(): ChildProcess {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the app reads stdout and kills it
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    kill: () => true,
  }) as unknown as ChildProcess
}

describe("the iOS app", () => {
  it("starts afresh: stopped, data emptied, permissions granted, launched with its environment", async () => {
    const data = await container()
    const fake = fakeXcrun({ get_app_container: `${data}\n`, "plutil -extract": "DanwoShop\n" })
    const app = new IosApp(
      new SimulatorTool(new Simctl(fake.exec), UDID),
      {
        bundleId: "com.danwo.shopmobile",
        app: "/builds/shop.app",
        launchArgs: ["-seed", "1"],
        env: { SHOP_MODE: "test" },
        permissions: ["photos"],
      },
      fake.exec,
      fakeChild,
    )

    await app.install()
    await app.start()

    expect(fake.commands).toEqual([
      `install ${UDID} /builds/shop.app`,
      "plutil -extract CFBundleExecutable raw /builds/shop.app/Info.plist",
      `terminate ${UDID} com.danwo.shopmobile`,
      `terminate ${UDID} com.apple.mobilesafari`,
      `get_app_container ${UDID} com.danwo.shopmobile data`,
      `privacy ${UDID} grant photos com.danwo.shopmobile`,
      `launch --terminate-running-process ${UDID} com.danwo.shopmobile -seed 1`,
    ])
    expect(fake.envs).toContainEqual({ SIMCTL_CHILD_SHOP_MODE: "test" })
    expect((await readdir(data)).toSorted()).toEqual([
      ".com.apple.mobile_container_manager.metadata.plist",
      "Documents",
      "Library",
      "SystemData",
      "tmp",
    ])
    expect(existsSync(join(data, "Library", "Application Support"))).toBe(false)
    expect(existsSync(join(data, "Library", "Preferences"))).toBe(true)
    app.close()
  })

  it("says so when the app is not installed", async () => {
    const fake = fakeXcrun({ get_app_container: "(null)" })
    const app = new IosApp(
      new SimulatorTool(new Simctl(fake.exec), UDID),
      { bundleId: "com.danwo.missing" },
      fake.exec,
      fakeChild,
    )

    await expect(app.start()).rejects.toThrow(`com.danwo.missing is not installed on ${UDID}`)
  })

  it("reads the unified log's lines and passes the environment the way simctl wants it", () => {
    expect(
      parseLogLine(
        JSON.stringify({
          timestamp: "2026-10-21 22:08:31.440000+0100",
          messageType: "Error",
          eventMessage: "fetch failed",
        }),
      ),
    ).toEqual({ at: "2026-10-21T21:08:31.440Z", level: "error", text: "fetch failed" })
    expect(parseLogLine("Filtering the log data using …")).toBeUndefined()
    expect(childEnv({ A: "1" })).toEqual({ SIMCTL_CHILD_A: "1" })
  })
})

/** A driver that shows `screens` in turn (the last one stays), recording what it does. */
function scriptedDriver(screens: readonly (readonly DriverNode[])[], failTap?: Error) {
  const acts: string[] = []
  let shown = 0
  let failed = false
  const driver: DeviceDriver = {
    open: async (app) => void acts.push(`open ${app}`),
    snapshot: async () => screens[Math.min(shown++, screens.length - 1)] ?? [],
    tap: async (ref) => {
      acts.push(`tap ${ref}`)

      if (failTap !== undefined && !failed) {
        failed = true
        throw failTap
      }
    },
    fill: async (ref, text) => void acts.push(`fill ${ref} ${text}`),
    tapAt: async (x, y) => void acts.push(`tapAt ${x} ${y}`),
    swipe: async (from, to) => void acts.push(`swipe ${from.x},${from.y} ${to.x},${to.y}`),
    back: async () => void acts.push("back"),
    pressEnter: async () => void acts.push("enter"),
    dismissKeyboard: async () => void acts.push("dismiss keyboard"),
    screenshot: async () => false,
    close: async () => void acts.push("close"),
  }

  return { acts, driver }
}

const SCREEN: DriverNode[] = [
  {
    index: 0,
    type: "Application",
    label: "Danwo Shop",
    rect: { x: 0, y: 0, width: 400, height: 800 },
  },
  { index: 1, parentIndex: 0, type: "Button", label: "Pay", ref: "e2" },
]

/** An iOS device over a fake simctl, a scripted driver and a proxy that saw `exchanges`. */
async function device(
  screens: readonly (readonly DriverNode[])[],
  options: { exchanges?: Exchange[]; failTap?: Error } = {},
) {
  const fake = fakeXcrun({
    "list devices": JSON.stringify(deviceListing([{ name: "danwo iPhone", state: "Booted" }])),
  })
  const { acts, driver } = scriptedDriver(screens, options.failTap)
  const opened = await iosDevice({
    app: { bundleId: "com.danwo.shopmobile", scheme: "danwoshop" },
    proxy: {
      url: "http://127.0.0.1:8002",
      caCert: "-----BEGIN CERTIFICATE-----\n",
      exchanges: () => options.exchanges ?? [],
    },
    exec: fake.exec,
    driver: () => driver,
    proxyHelper: "/helper/danwo-sim-proxy",
    stateDir: "/tmp/state",
  })

  return { acts, fake, opened }
}

describe("an iOS device", () => {
  it("binds, opens the app, and reads the screen in pixels while it acts in points", async () => {
    const { acts, fake, opened } = await device([SCREEN])

    expect(opened.platform).toBe("ios")
    expect(acts).toEqual(["open com.danwo.shopmobile"])
    expect(fake.store()).toMatchObject({ HTTPSProxy: "127.0.0.1", HTTPSPort: 8002 })

    const reading = await opened.read()

    expect(reading.nodes[0]?.box).toEqual({ x: 0, y: 0, width: 1200, height: 2400 })

    await opened.tapAt(300, 600)
    await opened.scroll("down")
    await opened.pressKey("Enter")
    await opened.back()
    await expect(opened.pressKey("Tab")).rejects.toThrow('iOS has no "Tab" key')
    expect(acts.slice(1)).toEqual(["tapAt 100 200", "swipe 200,600 200,200", "enter", "back"])

    await opened.close()
    expect(acts.at(-1)).toBe("close")
    expect(fake.store()).toEqual({ ExceptionsList: ["*.local"], FTPPassive: 1 })
  })

  it("puts the keyboard away and taps the same element again when the keyboard covers it", async () => {
    const moved: DriverNode[] = [SCREEN[0]!, { ...SCREEN[1]!, ref: "e7" }]
    const { acts, opened } = await device([SCREEN, moved], {
      failTap: new Error("Ref @e2 is behind the visible keyboard and cannot be tapped safely"),
    })

    await opened.read()
    await opened.tap("e2")
    expect(acts.slice(1)).toEqual(["tap e2", "dismiss keyboard", "tap e7"])
  })

  it("knows a Safari view in front, and the page it shows from the proxy's exchanges", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the device reads
    const page = {
      host: "checkout.stripe.com",
      path: "/checkout/cs_1",
      request: { headers: { accept: "text/html" } },
    } as unknown as Exchange
    const browser = [
      ...SCREEN,
      { index: 2, parentIndex: 0, type: "Other", identifier: "TopBrowserBar" },
    ]
    const { opened } = await device([browser], { exchanges: [page] })

    expect(await opened.foreground()).toEqual({
      package: "com.apple.SafariViewService",
      browser: true,
      url: "https://checkout.stripe.com/checkout/cs_1",
    })
  })

  it("needs an environment with a proxy", async () => {
    await expect(
      withIosDevice({ close: async () => undefined }, { app: { bundleId: "com.danwo.x" } }),
    ).rejects.toThrow("withIosDevice needs an environment with a proxy")
  })
})

/** A Mac with Xcode's command-line tools and no Xcode. */
const commandLineToolsOnly: Exec = async (file) =>
  file === "xcode-select" ? "/Library/Developer/CommandLineTools\n" : ""

describe("iOS doctor", () => {
  it("fails Xcode's command-line tools alone, which have no Simulator", async () => {
    expect(await iosDoctor(commandLineToolsOnly)).toEqual([
      expect.objectContaining({
        name: "Xcode",
        status: "fail",
        detail: expect.stringContaining("command-line tools only"),
      }),
    ])
  })

  it("lists Xcode, the runtimes and the simulator danwo would create", async () => {
    const fake = fakeXcrun({
      "xcode-select -p": "/Applications/Xcode.app/Contents/Developer\n",
      "xcodebuild -version": "Xcode 26.6\nBuild version 17F113\n",
      "list runtimes": JSON.stringify(RUNTIMES),
      "list devices": JSON.stringify(deviceListing([])),
      "pod --version": "1.17.0\n",
    })
    const checks = await iosDoctor(fake.exec)

    expect(checks.map((check) => `${check.status} ${check.name}`)).toEqual([
      "ok Xcode",
      "ok simctl",
      "ok iOS runtimes",
      "ok simulators",
      "ok CocoaPods",
    ])
    expect(checks[2]?.detail).toBe("iOS 18.6, iOS 26.5")
    expect(checks[3]?.detail).toContain('creates "danwo iPhone" (iPhone 17 Pro, iOS 26.5)')
  })
})
