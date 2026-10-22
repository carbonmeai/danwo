import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { isNetworkTarget, remoteTarget, stateOf } from "../src/android/remote.ts"
import {
  Adb,
  AndroidBinder,
  type DeviceDriver,
  type Exec,
  useRemoteDevice,
  withAndroidDevice,
} from "../src/index.ts"

const CA = readFileSync(new URL("./fixtures/proxy-ca.pem", import.meta.url), "utf8")
const TOOLS = { sdk: "/sdk", adb: "/sdk/platform-tools/adb", emulator: "/sdk/emulator/emulator" }
const TARGET = "10.0.0.5:5555"

/** How the fake remote device behaves. */
interface Remote {
  /** What `adb connect` prints; a thrown error when it is an Error. */
  readonly connect?: string | Error
  /** The states `adb devices` lists the target in, one per call (the last one stays). */
  readonly states?: readonly (string | undefined)[]
  /** What `getprop ro.build.version.sdk` says. */
  readonly sdk?: string
  /** `adb root`: adbd turns root, or the build refuses it. Default: adbd is root already. */
  readonly root?: "turns" | "refused"
  /** Global settings the device has before the run. */
  readonly settings?: Readonly<Record<string, string>>
  /** What other shell commands print, by a piece of the command. */
  readonly answers?: Readonly<Record<string, string>>
  /** The serial adb lists the device under. Default: the target. */
  readonly serial?: string
}

/** What the fake adb answers to commands that start with a prefix; undefined passes it on. */
type Answer = (rest: string) => string | undefined

const SETTING = "shell settings get global "

/** The fake's answers, by the start of the command. */
function answersOf(remote: Remote): ReadonlyArray<readonly [string, Answer]> {
  const states = [...(remote.states ?? ["device"])]
  let rooted = remote.root === undefined

  const listed = () => {
    const state = states.length > 1 ? states.shift() : states[0]

    return state === undefined ? "" : `${remote.serial ?? TARGET}\t${state}\n`
  }

  const root = () => {
    if (remote.root === "refused") return "adbd cannot run as root in production builds\n"

    rooted = true

    return "restarting adbd as root\n"
  }

  return [
    ["connect ", () => connectAnswer(remote)],
    ["devices", () => `List of devices attached\nemulator-5554\tdevice\n${listed()}`],
    ["root", root],
    ["shell id -u", () => (rooted ? "0" : "2000")],
    ["shell getprop ro.build.version.sdk", () => remote.sdk ?? "34"],
    [SETTING, (name) => remote.settings?.[name] ?? "null"],
  ]
}

/** What `adb connect` prints, or throws. */
function connectAnswer(remote: Remote): string {
  if (remote.connect instanceof Error) throw remote.connect

  return remote.connect ?? `connected to ${TARGET}`
}

/** An adb server with one remote device, recording every command (without `-s <serial>`). */
function remoteAdb(remote: Remote = {}) {
  const commands: string[] = []
  const answers = answersOf(remote)

  const exec: Exec = async (_file, args) => {
    const command = args.join(" ").replace(/^-s \S+ /, "")

    commands.push(command)

    const known = answers.find(([start]) =>
      start.endsWith(" ") ? command.startsWith(start) : command === start,
    )

    if (known !== undefined) return known[1](command.slice(known[0].length)) ?? ""

    const key = Object.keys(remote.answers ?? {}).find((each) => command.includes(each))

    return key === undefined ? "" : (remote.answers?.[key] ?? "")
  }

  return { commands, exec }
}

/** A driver that records what it is asked. */
function recordingDriver() {
  const acts: string[] = []
  const driver: DeviceDriver = {
    open: async (app) => void acts.push(`open ${app}`),
    snapshot: async () => [],
    tap: async () => undefined,
    fill: async () => undefined,
    screenshot: async () => false,
    close: async () => void acts.push("close"),
  }

  return { acts, driver }
}

/** A worker environment with only what a device reads. */
function proxied(acts: string[]) {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the device reads only these
    proxy: { url: "http://127.0.0.1:41234", caCert: CA, exchanges: () => [] } as never,
    close: async () => void acts.push("env closed"),
  }
}

describe("the remote target", () => {
  it("comes from the option, one per worker, and the env variable overrides it", () => {
    expect(remoteTarget({}, {})).toBeUndefined()
    expect(remoteTarget({ adb: TARGET }, {})).toBe(TARGET)
    expect(remoteTarget({ adb: ["a:1", "b:2"], worker: 1 }, {})).toBe("b:2")
    expect(remoteTarget({ adb: TARGET }, { DANWO_ADB_TARGET: "ci-host:7000" })).toBe("ci-host:7000")
    expect(remoteTarget({}, { DANWO_ADB_TARGET: " a:1, b:2 ", ANDROID_HOME: "/x" })).toBe("a:1")
    expect(remoteTarget({ worker: 1 }, { DANWO_ADB_TARGET: "a:1,b:2" })).toBe("b:2")
    /* An empty variable leaves the config's choice alone. */
    expect(remoteTarget({ adb: TARGET }, { DANWO_ADB_TARGET: "" })).toBe(TARGET)
  })

  it("names a worker that has no device of its own", () => {
    expect(() => remoteTarget({ adb: "a:1", worker: 2 }, {})).toThrow(
      "worker 2 has no remote device: 1 adb target for 3 workers",
    )
  })

  it("tells a network address from a serial, and reads a device's state from adb's listing", () => {
    expect(isNetworkTarget("10.0.0.5:5555")).toBe(true)
    expect(isNetworkTarget("farm.example.test:40001")).toBe(true)
    expect(isNetworkTarget("[fe80::1]:5555")).toBe(true)
    expect(isNetworkTarget("emulator-5554")).toBe(false)
    expect(isNetworkTarget("R58M123ABC")).toBe(false)

    const listing = `List of devices attached\n${TARGET}\tunauthorized\nemulator-5554\tdevice\n`

    expect(stateOf(listing, TARGET)).toBe("unauthorized")
    expect(stateOf(listing, "emulator-5554")).toBe("device")
    expect(stateOf(listing, "other:1")).toBeUndefined()
  })
})

describe("connecting to a remote device", () => {
  it("connects, waits for it, checks its API level, and disconnects the connection it made", async () => {
    const { commands, exec } = remoteAdb({ states: [undefined, "offline", "device"] })
    const device = await useRemoteDevice(TOOLS, TARGET, {}, exec)

    expect(device.adb.serial).toBe(TARGET)
    expect(device.booted).toBe(false)
    await device.stop()
    expect(commands).toEqual([
      `connect ${TARGET}`,
      "devices",
      "devices",
      "devices",
      "shell getprop ro.build.version.sdk",
      `disconnect ${TARGET}`,
    ])
  })

  it("leaves a connection it did not make, and connects nothing for a serial", async () => {
    const already = remoteAdb({ connect: `already connected to ${TARGET}` })

    await (await useRemoteDevice(TOOLS, TARGET, {}, already.exec)).stop()
    expect(already.commands).not.toContain(`disconnect ${TARGET}`)

    const usb = remoteAdb({ serial: "R58M123ABC" })
    const device = await useRemoteDevice(TOOLS, "R58M123ABC", { connectTimeoutMs: 0 }, usb.exec)

    await expect(device.stop()).resolves.toBeUndefined()
    expect(usb.commands.some((command) => /^(connect|disconnect) /.test(command))).toBe(false)
  })

  it("says a target cannot be reached, whether adb fails or only prints so", async () => {
    const refused = remoteAdb({
      connect: `failed to connect to '${TARGET}': Connection refused\n`,
    })

    await expect(useRemoteDevice(TOOLS, TARGET, {}, refused.exec)).rejects.toThrow(
      `${TARGET} is not reachable over adb: failed to connect to '${TARGET}': Connection refused`,
    )
    expect(refused.commands).toEqual([`connect ${TARGET}`])

    const timedOut = remoteAdb({ connect: new Error("adb connect: timed out (SIGTERM)") })

    await expect(useRemoteDevice(TOOLS, TARGET, {}, timedOut.exec)).rejects.toThrow(
      `${TARGET} is not reachable over adb: adb connect: timed out`,
    )

    const gone = remoteAdb({ states: ["offline"] })

    await expect(
      useRemoteDevice(TOOLS, TARGET, { connectTimeoutMs: 0 }, gone.exec),
    ).rejects.toThrow(`${TARGET} is not reachable over adb (offline after 0 ms)`)
    expect(gone.commands.at(-1)).toBe(`disconnect ${TARGET}`)
  })

  it("says the device has not authorized this computer", async () => {
    const { commands, exec } = remoteAdb({
      connect: `failed to authenticate to ${TARGET}\n`,
      states: ["unauthorized"],
    })

    await expect(useRemoteDevice(TOOLS, TARGET, { connectTimeoutMs: 0 }, exec)).rejects.toThrow(
      `${TARGET} has not authorized this computer for debugging`,
    )
    expect(commands.at(-1)).toBe(`disconnect ${TARGET}`)
  })

  it("refuses a device too old for a user CA, and disconnects it", async () => {
    const { commands, exec } = remoteAdb({ sdk: "23" })

    await expect(useRemoteDevice(TOOLS, TARGET, {}, exec)).rejects.toThrow(
      `${TARGET} runs API 23; danwo needs API 24 (Android 7) or newer`,
    )
    expect(commands.at(-1)).toBe(`disconnect ${TARGET}`)
  })
})

describe("binding a remote device", () => {
  it("connects again after adb root restarts adbd, before waiting for the device", async () => {
    const { commands, exec } = remoteAdb({ root: "turns" })
    const reconnects: string[] = []
    const binder = new AndroidBinder(new Adb(TOOLS.adb, TARGET, exec), {
      caCert: CA,
      proxyPort: 41234,
      reconnect: async () => {
        reconnects.push("reconnect")
        commands.push("(reconnect)")
      },
    })

    await binder.rebind()
    expect(commands.slice(0, 5)).toEqual([
      "shell id -u",
      "root",
      "(reconnect)",
      "wait-for-device",
      "shell id -u",
    ])
    expect(reconnects).toHaveLength(1)
  })

  it("says so at once when the build cannot run adbd as root", async () => {
    const { commands, exec } = remoteAdb({ root: "refused" })
    const binder = new AndroidBinder(new Adb(TOOLS.adb, TARGET, exec), {
      caCert: CA,
      proxyPort: 41234,
    })

    await expect(binder.bind()).rejects.toThrow(
      `${TARGET} cannot run adbd as root, which danwo needs to add its CA`,
    )
    expect(commands.filter((command) => command === "root")).toHaveLength(1)
  })

  it("reverses more ports, and gives a shared device back its CA store, Chrome and settings", async () => {
    const { commands, exec } = remoteAdb({ settings: { window_animation_scale: "1.0" } })
    const binder = new AndroidBinder(new Adb(TOOLS.adb, TARGET, exec), {
      caCert: CA,
      proxyPort: 41234,
      reverse: [8081],
      restore: true,
    })

    await binder.bind()
    expect(commands).toContain("reverse tcp:8081 tcp:8081")
    expect(commands.indexOf("shell settings get global window_animation_scale")).toBeLessThan(
      commands.indexOf("shell settings put global window_animation_scale 0"),
    )

    const bound = commands.length

    await binder.unbind()
    expect(commands.slice(bound)).toEqual([
      "shell settings put global http_proxy :0",
      "reverse --remove-all",
      "shell rm -f /data/misc/user/0/cacerts-added/e0fa6ee6.0",
      "shell am clear-debug-app",
      "shell rm -f /data/local/tmp/chrome-command-line",
      "shell settings put global window_animation_scale 1.0",
      "shell settings delete global transition_animation_scale",
      "shell settings delete global animator_duration_scale",
      "shell settings delete global captive_portal_mode",
    ])
  })

  it("gives a shared device back an adbd that is not root, when it made it root", async () => {
    const { commands, exec } = remoteAdb({ root: "turns" })
    const binder = new AndroidBinder(new Adb(TOOLS.adb, TARGET, exec), {
      caCert: CA,
      proxyPort: 41234,
      restore: true,
      reconnect: async () => void commands.push("(reconnect)"),
    })

    await binder.bind()
    await binder.unbind()
    expect(commands.slice(-2)).toEqual(["unroot", "(reconnect)"])
  })
})

/** A device on the fake remote target, with the emulator options set too (they must go unused). */
async function remoteDevice(remote: Remote, options: { env?: NodeJS.ProcessEnv } = {}) {
  const { commands, exec } = remoteAdb(remote)
  const { acts, driver } = recordingDriver()
  const serials: string[] = []
  const stateDir = await mkdtemp(join(tmpdir(), "danwo-remote-"))
  const open = () =>
    withAndroidDevice(proxied(acts), {
      avd: "danwo_spike",
      snapshot: "booted",
      adb: TARGET,
      reverse: [8081],
      app: { package: "com.danwo.shopmobile", apk: "/builds/app.apk", scheme: "danwoshop" },
      tools: TOOLS,
      exec,
      stateDir,
      env: options.env ?? {},
      driver: (serial) => {
        serials.push(serial)

        return driver
      },
    })

  return { open, commands, acts, serials, stateDir }
}

describe("an Android device over adb", () => {
  it("runs on the remote device without any emulator command, and cleans up after itself", async () => {
    const { open, commands, acts, serials, stateDir } = await remoteDevice({
      states: ["offline", "device"],
      settings: { animator_duration_scale: "0.5" },
    })

    try {
      const env = await open()

      expect(env.device.serial).toBe(TARGET)
      expect(serials).toEqual([TARGET])
      expect(acts).toEqual(["open com.danwo.shopmobile"])
      await env.close()
    } finally {
      await rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    /* No boot, snapshot or console command: the AVD and snapshot options are not used. */
    expect(commands.filter((command) => /^emu\b|snapshot|wait-for-boot/.test(command))).toEqual([])
    expect(commands[0]).toBe(`connect ${TARGET}`)
    expect(commands).toContain("reverse tcp:8765 tcp:41234")
    expect(commands).toContain("reverse tcp:8081 tcp:8081")
    expect(commands).toContain("shell settings put global http_proxy 127.0.0.1:8765")
    expect(commands).toContain("install -r -g /builds/app.apk")
    expect(acts).toEqual(["open com.danwo.shopmobile", "close", "env closed"])
    expect(commands.slice(commands.indexOf("uninstall com.danwo.shopmobile"))).toEqual([
      "uninstall com.danwo.shopmobile",
      "shell settings put global http_proxy :0",
      "reverse --remove-all",
      "shell rm -f /data/misc/user/0/cacerts-added/e0fa6ee6.0",
      "shell am clear-debug-app",
      "shell rm -f /data/local/tmp/chrome-command-line",
      "shell settings delete global window_animation_scale",
      "shell settings delete global transition_animation_scale",
      "shell settings put global animator_duration_scale 0.5",
      "shell settings delete global captive_portal_mode",
      `disconnect ${TARGET}`,
    ])
  })

  it("enables again an app it disabled for the link scheme", async () => {
    const { open, commands, stateDir } = await remoteDevice({
      answers: { "query-activities": "com.danwo.shopmobile/.Main\ncom.other.shop/.Links" },
    })

    try {
      await (await open()).close()
    } finally {
      await rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    expect(commands).toContain("shell pm disable-user --user 0 com.other.shop")
    expect(commands).toContain("shell pm enable --user 0 com.other.shop")
  })

  it("takes the target from DANWO_ADB_TARGET, so CI can point a run at its devices", async () => {
    const { open, commands, stateDir } = await remoteDevice(
      {},
      { env: { DANWO_ADB_TARGET: TARGET } },
    )

    try {
      await (await open()).close()
    } finally {
      await rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    expect(commands[0]).toBe(`connect ${TARGET}`)
  })

  it("cleans up and disconnects when binding fails", async () => {
    const { open, commands, acts, stateDir } = await remoteDevice({ root: "refused" })

    try {
      await expect(open()).rejects.toThrow("cannot run adbd as root")
    } finally {
      await rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    expect(acts).toEqual([])
    expect(commands.slice(-3)).toEqual([
      "shell settings put global http_proxy :0",
      "reverse --remove-all",
      `disconnect ${TARGET}`,
    ])
  })
})
