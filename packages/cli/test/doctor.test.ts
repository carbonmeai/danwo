import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { SKILL_FILE } from "@danwo/skill"
import { afterEach, describe, expect, it } from "vitest"

import { type DoctorProbes, doctorLines, projectDoctor } from "../src/doctor.ts"

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

const ready: DoctorProbes = {
  nodeVersion: "v24.17.0",
  env: {},
  browser: async () => ({ ok: true, detail: "Chromium 156.0.0.0" }),
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
})
