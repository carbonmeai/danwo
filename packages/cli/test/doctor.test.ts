import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { SKILL_FILE } from "@danwo/skill"
import { afterEach, describe, expect, it } from "vitest"

import {
  type DoctorCheck,
  type DoctorProbes,
  doctorLines,
  type MobilePlatform,
  projectDoctor,
} from "../src/doctor.ts"

const CODEX_MODULE = String(new URL("../../runner/src/model/cli/codex.ts", import.meta.url))
const FAKE_CODEX = fileURLToPath(
  new URL("../../runner/test/fixtures/fake-codex.ts", import.meta.url),
)

/** A config whose model is Codex on the stand-in CLI, in `mode`. */
function cliConfig(mode: string): string {
  return [
    `import { codexCli } from ${JSON.stringify(CODEX_MODULE)}`,
    "",
    "export default {",
    `  model: codexCli({ command: [process.execPath, ${JSON.stringify(FAKE_CODEX)}], env: { FAKE_CLI_MODE: ${JSON.stringify(mode)} } }),`,
    "}",
    "",
  ].join("\n")
}

const made: string[] = []

afterEach(async () => {
  await Promise.all(
    made
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  )
})

async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "danwo-doctor-"))

  made.push(root)

  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), text)
  }

  return root
}

/** A machine with every device toolchain, as `danwo device doctor` reports it. */
const DEVICES: Readonly<Record<MobilePlatform, readonly DoctorCheck[]>> = {
  ios: [
    {
      name: "Xcode",
      status: "ok",
      detail: "Xcode 26.6 (/Applications/Xcode.app/Contents/Developer)",
    },
    { name: "iOS runtimes", status: "ok", detail: "iOS 26.5" },
  ],
  android: [
    { name: "Android SDK", status: "ok", detail: "/sdk" },
    { name: "adb", status: "ok", detail: "/sdk/platform-tools/adb" },
    { name: "emulator", status: "ok", detail: "/sdk/emulator/emulator" },
    { name: "JDK", status: "ok", detail: "/jdk" },
  ],
}

const ready: DoctorProbes = {
  nodeVersion: "v24.17.0",
  env: {},
  browser: async () => ({ ok: true, detail: "Chromium 156.0.0.0" }),
  device: async (platform) => DEVICES[platform],
  flutter: async () => [{ name: "Flutter", status: "ok", detail: "Flutter 3.47.7" }],
  /* Every optional package, at this danwo's version (the repository's). */
  installed: () => "0.0.0",
}

/** A project that installed none of the optional packages. */
const webOnly: DoctorProbes = { ...ready, installed: () => undefined }

/** A machine with no Android SDK, as `danwo device doctor --platform android` reports it. */
const NO_ANDROID: readonly DoctorCheck[] = [
  {
    name: "Android SDK",
    status: "fail",
    detail: "not found: set ANDROID_HOME or install Android Studio",
  },
]

/**
 * A config that binds its devices the way `@danwo/mobile`'s helpers do, named after them. The
 * stand-ins keep the config loadable in a folder with no `node_modules`.
 */
function deviceConfig(helpers: readonly string[]): string {
  return [
    ...helpers.map((name) => `const ${name} = (env: object) => env`),
    "",
    "export default {",
    `  environment: async () => [${helpers.map((name) => `${name}({})`).join(", ")}],`,
    "}",
    "",
  ].join("\n")
}

/** `probes` that note each platform the device checks are asked for in `asked`. */
function noting(asked: string[], probes: DoctorProbes = ready): DoctorProbes {
  return {
    ...probes,
    device: async (platform) => {
      asked.push(platform)

      return probes.device(platform)
    },
  }
}

/** The checks by name, as `status detail`. */
function byName(checks: Awaited<ReturnType<typeof projectDoctor>>): Record<string, string[]> {
  const named: Record<string, string[]> = {}

  for (const check of checks) (named[check.name] ??= []).push(`${check.status} ${check.detail}`)

  return named
}

describe("danwo doctor", () => {
  it("passes a ready project, its model's key set", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": 'export default { model: "anthropic/claude-sonnet-5" }\n',
    })
    const checks = await projectDoctor(
      { cwd: root },
      { ...ready, env: { AI_GATEWAY_API_KEY: "key" } },
    )

    expect(checks.every((check) => check.status === "ok")).toBe(true)
    expect(byName(checks)["model"]).toEqual(["ok AI_GATEWAY_API_KEY is set"])
  })

  it("names what a first run would trip on", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": 'export default { retires: 2, model: "anthropic/claude-sonnet-5" }\n',
      "node_modules/@playwright/test/package.json":
        '{ "name": "@playwright/test", "version": "1.52.0" }',
      ".claude/skills/danwo/SKILL.md": "an older skill\n",
    })
    const checks = await projectDoctor(
      { cwd: root },
      {
        ...ready,
        nodeVersion: "v22.12.0",
        browser: async () => ({
          ok: false,
          detail:
            "browserType.launch: Chromium is not installed for danwo. Run `npx @danwo/cli install-browser`",
        }),
      },
    )
    const named = byName(checks)

    expect(named["Node.js"]).toEqual(["fail v22.12.0; danwo needs Node.js 24 or newer"])
    expect(named["Chromium"]?.[0]).toMatch(/^fail Chromium is not installed for danwo/)
    expect(named["config"]?.[1]).toContain("unknown config key `retires` (did you mean `retries`?)")
    expect(named["model"]?.[0]).toMatch(/^warn AI_GATEWAY_API_KEY is not set/)
    expect(named["@playwright/test"]).toEqual([
      "fail 1.52.0; @danwo/playwright takes 1.60.0 to 1.x",
    ])
    expect(named["skill"]?.[0]).toMatch(/^warn \.claude\/skills\/danwo differs from danwo/)
  })

  it("checks every browser the config runs in, and Chromium for record and the MCP server", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": 'export default { browser: { name: ["webkit", "firefox"] } }\n',
    })
    const asked: string[] = []
    const checks = await projectDoctor(
      { cwd: root },
      {
        ...ready,
        browser: async (engine) => {
          asked.push(engine)

          return engine === "webkit"
            ? {
                ok: false,
                detail:
                  "browserType.launch: WebKit is not installed for danwo. Run `npx @danwo/cli install-browser --browser webkit`",
              }
            : { ok: true, detail: `${engine} 1.0` }
        },
      },
    )
    const named = byName(checks)

    expect(asked).toEqual(["chromium", "webkit", "firefox"])
    expect(named["Chromium"]).toEqual(["ok chromium 1.0"])
    expect(named["Firefox"]).toEqual(["ok firefox 1.0"])
    expect(named["WebKit"]?.[0]).toMatch(
      /^fail WebKit is not installed for danwo\. Run `npx @danwo\/cli install-browser --browser webkit`/,
    )
  })

  it("checks a model on a coding CLI by the CLI's own version and status commands", async () => {
    const working = await project({ "package.json": "{}", "danwo.config.ts": cliConfig("act") })
    const signedOut = await project({
      "package.json": "{}",
      "danwo.config.ts": cliConfig("signed-out"),
    })
    const signedIn = byName(await projectDoctor({ cwd: working }, ready))
    const out = byName(await projectDoctor({ cwd: signedOut }, ready))

    expect(signedIn["model"]).toEqual([
      "ok runs on the Codex CLI, signed in with a plan; no API key",
    ])
    expect(signedIn["Codex CLI"]).toEqual(["ok 9.9.9"])
    expect(signedIn["Codex CLI sign-in"]).toEqual(["ok signed in with ChatGPT"])
    expect(out["Codex CLI sign-in"]).toEqual([
      "fail not signed in; run `codex login` once in a terminal",
    ])
  })

  it("fails a config that does not load, and calls this danwo's skill current", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": "export default 3\n",
      ".agents/skills/danwo/SKILL.md": await readFile(SKILL_FILE, "utf8"),
    })
    const checks = await projectDoctor({ cwd: root }, ready)
    const named = byName(checks)

    expect(named["config"]?.[0]).toMatch(/^fail .*must default-export a config object/)
    expect(named["skill"]?.[0]).toMatch(/^ok \.agents\/skills\/danwo is danwo /)
    expect(doctorLines(checks)[0]).toBe("ok    Node.js: v24.17.0")
  })

  it("asks no device checks of a config that runs in the browser", async () => {
    const root = await project({ "package.json": "{}", "danwo.config.ts": "export default {}\n" })
    const asked: string[] = []
    const checks = await projectDoctor({ cwd: root }, noting(asked))

    expect(asked).toEqual([])
    expect(byName(checks)["devices"]).toBeUndefined()
  })

  it("checks Xcode and a simulator runtime for a config on the iOS Simulator", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": deviceConfig(["buildIos", "withIosDevice"]),
    })
    const asked: string[] = []
    const named = byName(await projectDoctor({ cwd: root }, noting(asked)))

    expect(asked).toEqual(["ios"])
    expect(named["devices"]).toEqual(["ok the config runs on iOS"])
    expect(named["Xcode"]?.[0]).toMatch(/^ok Xcode 26\.6/)
    expect(named["iOS runtimes"]).toEqual(["ok iOS 26.5"])
    expect(named["Flutter"]).toBeUndefined()
  })

  it("fails a config on the Android emulator on a machine without the SDK, and says how to fix it", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": [
        'import { device } from "./tests/stack/device.ts"',
        "",
        "export default { environment: async () => device() }",
        "",
      ].join("\n"),
      "tests/stack/device.ts": [
        "const withAndroidDevice = (env: object) => env",
        "",
        "export const device = () => withAndroidDevice({})",
        "",
      ].join("\n"),
    })
    const checks = await projectDoctor(
      { cwd: root },
      { ...ready, device: async (platform) => (platform === "android" ? NO_ANDROID : []) },
    )

    expect(byName(checks)["devices"]).toEqual(["ok the config runs on Android"])
    expect(byName(checks)["Android SDK"]).toEqual([
      "fail not found: set ANDROID_HOME or install Android Studio",
    ])
  })

  it("passes a config on both platforms when one is ready, and checks Flutter for a Flutter app", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": deviceConfig([
        "buildAndroid",
        "buildIos",
        "withAndroidDevice",
        "withIosDevice",
      ]),
      "app/pubspec.yaml": "name: waitlist\n",
    })
    const iosOnly = await projectDoctor(
      { cwd: root },
      { ...ready, device: async (platform) => (platform === "android" ? NO_ANDROID : DEVICES.ios) },
    )
    const named = byName(iosOnly)

    expect(named["devices"]).toEqual(["ok the config runs on iOS and Android"])
    expect(named["Android SDK"]).toEqual([
      "warn not found: set ANDROID_HOME or install Android Studio (needed only to run on Android)",
    ])
    expect(named["Flutter"]).toEqual(["ok Flutter 3.47.7"])
    expect(iosOnly.every((check) => check.status !== "fail")).toBe(true)

    const neither = byName(
      await projectDoctor(
        { cwd: root },
        {
          ...ready,
          device: async (platform) =>
            platform === "android"
              ? NO_ANDROID
              : [
                  {
                    name: "Xcode",
                    status: "fail",
                    detail: "not found: install Xcode from the App Store",
                  },
                ],
          flutter: async () => [
            { name: "Flutter", status: "fail", detail: "not found: install Flutter" },
          ],
        },
      ),
    )

    expect(neither["Android SDK"]?.[0]).toMatch(/^fail /)
    expect(neither["Xcode"]).toEqual(["fail not found: install Xcode from the App Store"])
    expect(neither["Flutter"]).toEqual(["fail not found: install Flutter"])
  })

  it("lists the optional packages: the version and features of each installed one", async () => {
    const root = await project({ "package.json": "{}", "danwo.config.ts": "export default {}\n" })
    const named = byName(await projectDoctor({ cwd: root }, ready))

    expect(named["@danwo/mobile"]).toEqual([
      "ok 0.0.0: mobile tests on Android and iOS: danwo device, build-android and build-ios",
    ])
    expect(named["@danwo/mcp"]).toEqual([
      "ok 0.0.0: danwo's MCP server for coding agents: danwo mcp",
    ])
    expect(named["@danwo/recorder"]).toEqual([
      "ok 0.0.0: recording a test in the browser: danwo record",
    ])
  })

  it("passes a web project without them, naming the command that adds each", async () => {
    const root = await project({
      "package.json": "{}",
      "pnpm-lock.yaml": "",
      "danwo.config.ts": "export default {}\n",
    })
    const checks = await projectDoctor({ cwd: root }, webOnly)

    expect(checks.every((check) => check.status === "ok")).toBe(true)
    expect(byName(checks)["@danwo/mobile"]).toEqual([
      "ok not installed; only mobile tests on Android and iOS: danwo device, build-android and build-ios (pnpm add -D @danwo/mobile)",
    ])
  })

  it("fails a config on devices without @danwo/mobile, and asks no device checks", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": deviceConfig(["withAndroidDevice"]),
    })
    const asked: string[] = []
    const named = byName(await projectDoctor({ cwd: root }, noting(asked, webOnly)))

    expect(asked).toEqual([])
    expect(named["devices"]).toBeUndefined()
    expect(named["@danwo/mobile"]).toEqual([
      "fail not installed; the config runs on devices: npm install -D @danwo/mobile",
    ])
  })

  it("warns when the coding agents start danwo's MCP server and @danwo/mcp is missing", async () => {
    const root = await project({
      "package.json": "{}",
      "danwo.config.ts": "export default {}\n",
      ".mcp.json": JSON.stringify({ mcpServers: { danwo: { command: "npx" } } }),
    })
    const named = byName(await projectDoctor({ cwd: root }, webOnly))

    expect(named["@danwo/mcp"]).toEqual([
      "warn not installed; the coding agents are set up to start danwo's MCP server: npm install -D @danwo/mcp",
    ])
  })
})
