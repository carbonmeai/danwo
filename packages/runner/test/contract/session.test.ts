/*
 * Contract: a web session opens the app, keeps secrets out of everything it records, and gives
 * the flight recorder steps with their source lines, screenshots, the app's log and the screen
 * at failure. Public API only.
 */
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession, type WebSession, type WebSessionOptions } from "../../src/index.ts"
import { type Site, startSite } from "./site.ts"

const TOKEN = "tok-contract-4f2a9c"
const PASSWORD = "pw-contract-81bd3e"

let site: Site

beforeAll(async () => {
  site = await startSite()
})

afterAll(async () => {
  await site.close()
})

async function withSession(
  options: Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<void>,
): Promise<WebSession> {
  const session = await openWebSession({ baseUrl: site.url, ...options })

  try {
    await run(session)
  } finally {
    await session.close()
  }

  return session
}

/** The line of this file that called it (the first frame is this function itself). */
function thisLine(): number {
  const frames = new Error().stack?.split("\n").filter((line) => line.includes("session.test.ts"))

  return Number(/session\.test\.ts:(\d+)/.exec(frames?.[1] ?? "")?.[1])
}

describe("app", () => {
  it("opens paths against the base URL, and the base URL itself by default", async () => {
    await withSession({}, async ({ app, screen, expect: check }) => {
      expect(app.baseUrl).toBe(site.url)
      await app.open()
      await check(screen.getByRole("heading", { name: "Contract site" })).toBeVisible()
      await app.open("/counter")
      await check(screen.getByRole("heading", { name: "Counter" })).toBeVisible()
    })
  }, 60_000)
})

describe("secrets", () => {
  const secrets = {
    token: TOKEN,
    password: { value: PASSWORD, purpose: "password" as const },
  }

  it("fills a secret by name and keeps its value out of steps and redacted text", async () => {
    const session = await withSession({ secrets }, async (open) => {
      const { app, screen } = open

      await app.open("/login")
      await screen.getByLabel("Token").fill(open.secret("token"))
      await screen.getByLabel("Password").fill(open.secret("password"))
      expect(await screen.getByLabel("Token").inputValue()).toBe(TOKEN)
    })

    const recorded = JSON.stringify(session.flight.steps())

    expect(recorded).not.toContain(TOKEN)
    expect(recorded).not.toContain(PASSWORD)
    expect(session.flight.redact(`a ${TOKEN} b ${PASSWORD} c`)).not.toMatch(
      new RegExp(`${TOKEN}|${PASSWORD}`),
    )
  }, 60_000)

  it("refuses to read a password field back", async () => {
    await withSession({ secrets }, async (open) => {
      await open.app.open("/login")
      await open.screen.getByLabel("Password").fill(open.secret("password"))
      await expect(open.screen.getByLabel("Password").inputValue()).rejects.toThrow(
        /getByLabel\("Password"\)/,
      )
    })
  }, 60_000)

  it("throws for a secret name the session was not given", async () => {
    await withSession({ secrets }, async (session) => {
      expect(() => session.secret("missing")).toThrow(/missing/)
    })
  }, 60_000)
})

describe("flight recorder", () => {
  it("records each step with its API, label, status and the test line that called it", async () => {
    let clickLine = 0
    const session = await withSession(
      { projectRoot: import.meta.dirname },
      async ({ app, screen, expect: check }) => {
        await app.open("/form")
        clickLine = thisLine() + 1
        await screen.getByRole("button", { name: "Save" }).click()
        await check(screen.getByTestId("status")).toHaveText("Saved ")
      },
    )
    const steps = session.flight.steps()
    const click = steps.find((step) => step.api === "locator.click")

    expect(steps.map((step) => step.api)).toEqual([
      "app.open",
      "locator.click",
      "expect.toHaveText",
    ])
    expect(steps.map((step) => step.index)).toEqual([0, 1, 2])
    expect(steps.every((step) => step.status === "passed")).toBe(true)
    expect(click?.label).toContain('getByRole("button", name: "Save")')
    expect(click?.source).toMatchObject({ file: "session.test.ts", line: clickLine })
  }, 60_000)

  it("records a failed step with its error", async () => {
    const session = await withSession({ actionTimeout: 500 }, async ({ app, screen }) => {
      await app.open("/form")
      await expect(screen.getByRole("button", { name: "Missing" }).click()).rejects.toThrow(
        /Missing/,
      )
    })
    const failed = session.flight.steps().find((step) => step.status === "failed")

    expect(failed?.api).toBe("locator.click")
    expect(failed?.error?.message).toContain('getByRole("button", name: "Missing")')
  }, 60_000)

  it("takes a screenshot after each step when asked, into a caller-owned directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-contract-shots-"))

    try {
      const session = await withSession(
        { artifactsDir: dir, record: { stepScreenshots: true } },
        async ({ app, screen, flight }) => {
          await app.open("/form")
          await screen.getByLabel("Email").fill("ada@danwo.test")
          await flight.settle()
        },
      )
      const shots = session.flight.screenshots()

      expect([...shots.keys()]).toEqual(expect.arrayContaining([0, 1]))
      for (const path of shots.values()) expect(existsSync(join(dir, path))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("keeps the app's console output, tagged with the step it came during", async () => {
    const session = await withSession({}, async ({ app, expect: check, screen }) => {
      await app.open("/login")
      await check(screen.getByRole("heading", { name: "Log in" })).toBeVisible()
    })
    const log = session.flight.appLog()

    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          text: expect.stringContaining("login page ready"),
        }),
        expect.objectContaining({
          level: "error",
          text: expect.stringContaining("login page warning"),
        }),
      ]),
    )
    expect(log.every((entry) => typeof entry.step === "number")).toBe(true)
  }, 60_000)

  it("captures the screen at failure: URL, screen text, screenshot and the nearest candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-contract-failure-"))

    try {
      await withSession({ artifactsDir: dir, actionTimeout: 500 }, async (session) => {
        await session.app.open("/form")
        const error = await session.screen
          .getByRole("listitem")
          .click()
          .catch((caught: unknown) => caught)
        const evidence = await session.flight.captureFailure(error)

        expect(evidence?.url).toBe(`${site.url}/form`)
        expect(evidence?.screenshot && existsSync(join(dir, evidence.screenshot))).toBe(true)
        expect(evidence?.screen).toBeDefined()
        expect(await readFile(join(dir, evidence?.screen ?? ""), "utf8")).toContain("Sign up")
        expect(evidence?.candidates?.join("\n")).toMatch(/Apple[\s\S]*Banana[\s\S]*Cherry/)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("masks credential-shaped text in the screen at failure, even values it was never given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-contract-keys-"))

    try {
      await withSession({ artifactsDir: dir }, async (session) => {
        await session.app.open("/keys")
        const evidence = await session.flight.captureFailure(new Error("failed"))
        const screen = await readFile(join(dir, evidence?.screen ?? ""), "utf8")

        expect(screen).toContain("API keys")
        expect(screen).toContain("sk_live_[redacted]")
        expect(screen).not.toContain("51NqA7bC9dE2fG4hJ6kL8mN0pQ")
        expect(screen).not.toContain("Zx81Qv0LmT5aRk2Yp9Hs")
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
