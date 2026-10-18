import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Exchange } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { AndroidApp, parseLogcat, topActivity } from "../src/android/app.ts"
import { androidCaFileName, subjectDer } from "../src/android/ca.ts"
import { bootArgs } from "../src/android/emulator.ts"
import {
  Adb,
  AndroidBinder,
  type DeviceDriver,
  deviceDoctor,
  deviceNodes,
  type DriverNode,
  type Exec,
  roleOf,
  withAndroidDevice,
} from "../src/index.ts"

const CA = readFileSync(new URL("./fixtures/proxy-ca.pem", import.meta.url), "utf8")
const TOOLS = { sdk: "/sdk", adb: "/sdk/platform-tools/adb", emulator: "/sdk/emulator/emulator" }

/** An `Exec` that records every adb command and answers from `answers` by the command's text. */
function fakeAdb(answers: Readonly<Record<string, string>> = {}) {
  const commands: string[] = []

  const exec: Exec = async (_file, args) => {
    const command = args.join(" ").replace(/^-s \S+ /, "")

    commands.push(command)

    const key = Object.keys(answers).find((each) => command.includes(each))

    return key === undefined ? "" : (answers[key] ?? "")
  }

  return { commands, exec }
}

/** A driver that shows `screens` in turn (the last one stays), recording taps and fills. */
function scriptedDriver(screens: readonly (readonly DriverNode[] | Error)[]) {
  const acts: string[] = []
  let shown = 0
  const driver: DeviceDriver = {
    open: async (app) => void acts.push(`open ${app}`),
    snapshot: async () => {
      const screen = screens[Math.min(shown++, screens.length - 1)] ?? []

      if (screen instanceof Error) throw screen

      return screen
    },
    tap: async (ref) => void acts.push(`tap ${ref}`),
    fill: async (ref, text) => void acts.push(`fill ${ref} ${text}`),
    screenshot: async () => false,
    close: async () => void acts.push("close"),
  }

  return { acts, driver }
}

describe("the CA's file name", () => {
  it("is the OpenSSL old subject hash of the certificate, as Android names it", () => {
    expect(androidCaFileName(CA)).toBe("e0fa6ee6.0")
    expect(subjectDer(CA).toString("latin1")).toContain("danwo proxy CA")
  })

  it("refuses something that is not a certificate", () => {
    expect(() => androidCaFileName("not a certificate")).toThrow("no start line")
  })
})

describe("the binder", () => {
  it("binds in order: root, CA, Chrome, a quiet device, then the proxy route", async () => {
    const { commands, exec } = fakeAdb({ "id -u": "2000" })
    const binder = new AndroidBinder(new Adb(TOOLS.adb, "emulator-5554", exec), {
      caCert: CA,
      proxyPort: 41234,
    })

    await binder.bind()

    const pushed = commands.find((each) => each.startsWith("push "))

    expect(pushed).toMatch(/\/e0fa6ee6\.0 \/data\/misc\/user\/0\/cacerts-added\/e0fa6ee6\.0$/)
    expect(commands.filter((each) => !each.startsWith("push "))).toEqual([
      "shell id -u",
      "root",
      "wait-for-device",
      "shell mkdir -p /data/misc/user/0/cacerts-added",
      "shell chown system:system /data/misc/user/0/cacerts-added/e0fa6ee6.0 && chmod 644 /data/misc/user/0/cacerts-added/e0fa6ee6.0 && restorecon /data/misc/user/0/cacerts-added/e0fa6ee6.0",
      "shell am set-debug-app --persistent com.android.chrome",
      "shell echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line",
      "shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS",
      "shell settings put global window_animation_scale 0",
      "shell settings put global transition_animation_scale 0",
      "shell settings put global animator_duration_scale 0",
      "shell settings put global captive_portal_mode 0",
      "reverse tcp:8765 tcp:41234",
      "shell settings put global http_proxy 127.0.0.1:8765",
    ])
  })

  it("rebinds without restarting a root adbd, and unbinds the proxy setting and reverse rules", async () => {
    const { commands, exec } = fakeAdb({ "id -u": "0" })
    const binder = new AndroidBinder(new Adb(TOOLS.adb, "emulator-5554", exec), {
      caCert: CA,
      proxyPort: 41234,
    })

    await binder.rebind()
    await binder.unbind()

    expect(commands).not.toContain("root")
    expect(commands.slice(-4)).toEqual([
      "reverse tcp:8765 tcp:41234",
      "shell settings put global http_proxy 127.0.0.1:8765",
      "shell settings put global http_proxy :0",
      "reverse --remove-all",
    ])
  })
})

describe("the app", () => {
  it("starts afresh: data cleared, permissions granted, the launcher activity started", async () => {
    const { commands, exec } = fakeAdb({
      "resolve-activity": "priority=0 preferredOrder=0\ncom.danwo.shopmobile/.MainActivity",
      "dumpsys activity":
        "topResumedActivity=ActivityRecord{1 u0 com.danwo.shopmobile/.MainActivity t3}",
    })
    const app = new AndroidApp(new Adb(TOOLS.adb, "emulator-5554", exec), {
      package: "com.danwo.shopmobile",
    })

    expect(await app.start()).toEqual({ relaunched: undefined })
    expect(commands).toEqual([
      "shell pm clear com.danwo.shopmobile",
      "shell am force-stop com.android.chrome",
      "shell am force-stop org.chromium.chrome",
      "shell am force-stop com.chrome.beta",
      "shell pm grant com.danwo.shopmobile android.permission.POST_NOTIFICATIONS",
      "shell logcat -c",
      "shell cmd package resolve-activity --brief com.danwo.shopmobile",
      "shell am start -n com.danwo.shopmobile/.MainActivity",
      "shell dumpsys activity activities",
    ])
  })

  it("stops and launches the app once more when the first launch did not bring it up", async () => {
    let front = "com.android.launcher3"
    const { commands, exec } = fakeAdb({
      "resolve-activity": "com.danwo.shopmobile/.MainActivity",
    })
    const app = new AndroidApp(
      new Adb(TOOLS.adb, "emulator-5554", async (file, args, options) => {
        const command = args.join(" ")

        if (command.includes("force-stop com.danwo.shopmobile")) front = "com.danwo.shopmobile"

        if (command.includes("dumpsys activity")) {
          return `topResumedActivity=ActivityRecord{1 u0 ${front}/.Main t3}`
        }

        return exec(file, args, options)
      }),
      { package: "com.danwo.shopmobile", launchWaitMs: 300 },
    )

    expect((await app.start()).relaunched).toMatch(
      /^not in front 300 ms after launch \(in front: com.android.launcher3\); stopped and launched again$/,
    )
    expect(commands.slice(-3)).toEqual([
      "shell am start -n com.danwo.shopmobile/.MainActivity",
      "shell am force-stop com.danwo.shopmobile",
      "shell am start -n com.danwo.shopmobile/.MainActivity",
    ])
  })

  it("says so when the app has no launcher", async () => {
    const { exec } = fakeAdb({ "resolve-activity": "No activity found" })
    const app = new AndroidApp(new Adb(TOOLS.adb, "emulator-5554", exec), { package: "x.y" })

    await expect(app.start()).rejects.toThrow("x.y is not installed or has no launcher")
  })

  it("reads what is in front, and the app's log lines since the last read", () => {
    const dump =
      "  topResumedActivity=ActivityRecord{1 u0 com.android.chrome/org.chromium.chrome.browser.customtabs.CustomTabActivity t9}"

    expect(topActivity(dump)).toEqual({
      package: "com.android.chrome",
      activity: "org.chromium.chrome.browser.customtabs.CustomTabActivity",
    })
    expect(topActivity("nothing")).toEqual({ package: "", activity: "" })

    const log = [
      "--------- beginning of main",
      "  1760000000.100  4242  4242 I ReactNativeJS: old line",
      "  1760000001.250  4242  4250 E ReactNativeJS: checkout failed",
      "  1760000002.000  4242  4250 W OkHttp: slow",
    ].join("\n")

    expect(parseLogcat(log, 1760000000.5)).toEqual([
      { at: "2025-10-09T08:53:21.250Z", level: "error", text: "ReactNativeJS: checkout failed" },
      { at: "2025-10-09T08:53:22.000Z", level: "warn", text: "OkHttp: slow" },
    ])
  })
})

describe("the emulator's command line", () => {
  it("boots headless without saving over the AVD's snapshots, cold or from a snapshot", () => {
    expect(bootArgs("danwo_spike", 5556, undefined)).toEqual([
      "-avd",
      "danwo_spike",
      "-port",
      "5556",
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-gpu",
      "swiftshader_indirect",
      "-no-snapshot-save",
      "-no-snapshot-load",
    ])
    expect(bootArgs("danwo_spike", 5554, "danwo_clean").slice(-2)).toEqual([
      "-snapshot",
      "danwo_clean",
    ])
  })
})

describe("the accessibility tree", () => {
  const nodes: DriverNode[] = [
    { index: 0, type: "android.widget.FrameLayout" },
    {
      index: 1,
      type: "android.widget.TextView",
      label: "Danwo Shop",
      heading: true,
      parentIndex: 0,
    },
    {
      index: 2,
      type: "android.view.ViewGroup",
      label: "Buy 500 credits",
      hittable: true,
      identifier: "buy",
      parentIndex: 0,
    },
    {
      index: 3,
      type: "android.widget.EditText",
      editable: true,
      placeholder: "Email",
      hintShowing: true,
      value: "Email",
      parentIndex: 0,
    },
    { index: 4, type: "android.widget.TextView", label: "9:41", systemBar: "status" },
    { index: 5, type: "android.widget.TextView", label: "hidden", visibleToUser: false },
    { index: 6, type: "android.webkit.WebView", label: "Checkout", hittable: true, parentIndex: 0 },
    {
      index: 7,
      type: "android.widget.ImageView",
      identifier: "com.android.chrome:id/toolbar_hairline",
      parentIndex: 0,
    },
  ]

  it("maps roles, names, test ids and field values the way locators read them", () => {
    const mapped = deviceNodes(nodes)

    expect(mapped.map((node) => node.role)).toEqual([
      "generic",
      "heading",
      "button",
      "textbox",
      "document",
      "img",
    ])
    expect(mapped[2]).toMatchObject({
      ref: "e3",
      name: "Buy 500 credits",
      testId: "buy",
      parent: "e1",
    })
    expect(mapped[3]).toMatchObject({ value: "", text: "", placeholder: "Email", editable: true })
    expect(mapped[5]).toMatchObject({ testId: "toolbar_hairline" })
  })

  it("names roles from Android widget classes and React Native's hints", () => {
    expect(roleOf({ index: 0, type: "android.widget.CheckBox" })).toBe("checkbox")
    expect(roleOf({ index: 0, type: "android.widget.Switch" })).toBe("switch")
    expect(roleOf({ index: 0, type: "android.widget.RadioButton" })).toBe("radio")
    expect(roleOf({ index: 0, type: "android.widget.Button" })).toBe("button")
    expect(roleOf({ index: 0, kind: "link" })).toBe("link")
    expect(roleOf({ index: 0, kind: "text" })).toBe("text")
    expect(roleOf({ index: 0 })).toBe("generic")
  })
})

describe("an Android device", () => {
  const screen: DriverNode[] = [
    { index: 0, type: "android.widget.FrameLayout" },
    {
      index: 1,
      type: "android.widget.TextView",
      label: "Credits: 0",
      identifier: "credits",
      parentIndex: 0,
    },
  ]
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the device reads
  const page = {
    host: "checkout.stripe.com",
    path: "/checkout/cs_1",
    request: { headers: { "sec-fetch-dest": "document" } },
  } as unknown as Exchange

  async function device(
    screens: readonly (readonly DriverNode[] | Error)[],
    answers: Record<string, string> = {},
  ) {
    const { commands, exec } = fakeAdb({
      devices: "emulator-5554\tdevice",
      boot_completed: "1",
      "id -u": "0",
      ...answers,
    })
    const { acts, driver } = scriptedDriver(screens)
    const stateDir = await mkdtemp(join(tmpdir(), "danwo-device-"))
    const env = await withAndroidDevice(
      {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the device reads only these
        proxy: { url: "http://127.0.0.1:41234", caCert: CA, exchanges: () => [page] } as never,
        get baseUrl() {
          return "http://127.0.0.1:1"
        },
        close: async () => void acts.push("env closed"),
      },
      {
        serial: "emulator-5554",
        app: { package: "com.danwo.shopmobile", apk: "/builds/app.apk", scheme: "danwoshop" },
        tools: TOOLS,
        exec,
        stateDir,
        driver: () => driver,
      },
    )

    return { env, commands, acts, stateDir }
  }

  it("binds, installs and opens the app, and reads the screen through its driver", async () => {
    const { env, commands, acts, stateDir } = await device([
      new Error("insufficient content"),
      screen,
    ])

    try {
      expect(env.device.serial).toBe("emulator-5554")
      expect(env.baseUrl).toBe("http://127.0.0.1:1")
      expect(commands).toContain("install -r -g /builds/app.apk")
      expect(acts).toEqual(["open com.danwo.shopmobile"])
      /* A reading that fails while one app hands over to another is tried again. */
      expect((await env.device.read()).nodes.map((node) => node.text)).toEqual(["", "Credits: 0"])

      await env.device.tap("e2")
      await env.device.fill("e2", "hello")
      await env.device.rebind()
      expect(acts.slice(1)).toEqual(["tap e2", "fill e2 hello"])
    } finally {
      await env.close()
      await rm(stateDir, { recursive: true, force: true })
    }

    expect(acts.slice(-2)).toEqual(["close", "env closed"])
    expect(commands.slice(-2)).toEqual([
      "shell settings put global http_proxy :0",
      "reverse --remove-all",
    ])
  })

  it("knows a Custom Tab in front, and the page it shows from the proxy's exchanges", async () => {
    const { env, stateDir } = await device([screen], {
      "dumpsys activity":
        "topResumedActivity=ActivityRecord{1 u0 com.android.chrome/org.chromium.chrome.browser.customtabs.CustomTabActivity t9}",
    })

    try {
      expect(await env.device.foreground()).toEqual({
        package: "com.android.chrome",
        browser: true,
        url: "https://checkout.stripe.com/checkout/cs_1",
      })
    } finally {
      await env.close()
      await rm(stateDir, { recursive: true, force: true })
    }
  })

  it("needs an environment with a proxy", async () => {
    await expect(
      withAndroidDevice(
        { close: async () => undefined },
        { app: { package: "x.y" }, tools: TOOLS },
      ),
    ).rejects.toThrow("needs an environment with a proxy")
  })
})

describe("device doctor", () => {
  it("reports a missing SDK as a failure", async () => {
    const saved = {
      home: process.env.ANDROID_HOME,
      root: process.env.ANDROID_SDK_ROOT,
      user: process.env.HOME,
    }
    const empty = await mkdtemp(join(tmpdir(), "danwo-no-sdk-"))

    process.env.ANDROID_HOME = join(empty, "missing")
    process.env.ANDROID_SDK_ROOT = join(empty, "missing")
    process.env.HOME = empty

    try {
      const checks = await deviceDoctor(fakeAdb().exec)

      expect(checks[0]).toMatchObject({ name: "Android SDK", status: "fail" })
    } finally {
      for (const [name, value] of [
        ["ANDROID_HOME", saved.home],
        ["ANDROID_SDK_ROOT", saved.root],
        ["HOME", saved.user],
      ] as const) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }

      await rm(empty, { recursive: true, force: true })
    }
  })
})
