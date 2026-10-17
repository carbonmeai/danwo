import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listeningPort } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { runAttempt } from "../src/runner/attempt.ts"
import type { DanwoConfig } from "../src/runner/config.ts"
import { SessionKeeper } from "../src/runner/sessions.ts"
import { test } from "../src/tests/api.ts"
import { declarationsOf, type FileDeclarations, sessionOf } from "../src/tests/registry.ts"
import type { SessionFixtures } from "../src/tests/types.ts"
import { ref, scripted } from "./fixtures/scripted.ts"

/** A site whose sign-in sets a cookie; `/home` says whether the browser is signed in. */
let server: Server
let baseUrl: string
let logins = 0

const page = (body: string) => `<!doctype html><title>Site</title><main>${body}</main>`

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://site").pathname
    const signedIn = (req.headers.cookie ?? "").includes("sid=s-1")

    if (path === "/login") {
      logins += 1
      res.writeHead(303, { location: "/home", "set-cookie": "sid=s-1; HttpOnly; Path=/" }).end()

      return
    }

    res.writeHead(200, { "content-type": "text/html" })
    res.end(
      path === "/home"
        ? page(`<h1>${signedIn ? "Signed in" : "Signed out"}</h1>`)
        : page(`<form action="/login"><button type="submit">Sign in</button></form>`),
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
})

afterAll(() => {
  server.close()
})

describe("sessionOf", () => {
  it("takes the test's option, else the innermost test.use, and false opts out", async () => {
    const file = await declarationsOf(async () => {
      test.use({ session: "file" })
      test("plain", () => undefined)
      test("own", { session: "own" }, () => undefined)
      test("out", { session: false }, () => undefined)
      test.describe("block", () => {
        test.use({ session: "block" })
        test("inner", () => undefined)
      })
    })

    expect(file.tests.map((t) => [t.title, sessionOf(file, t)])).toEqual([
      ["plain", "file"],
      ["own", "own"],
      ["out", undefined],
      ["inner", "block"],
    ])
  })
})

describe("SessionKeeper", () => {
  it("forgets kept states and failed setups when the environment resets", () => {
    const keeper = new SessionKeeper()

    keeper.keep("ada", { cookies: [], origins: [] })
    keeper.fail("eve", new Error("wrong password"))
    keeper.invalidate()

    expect(keeper.get("ada")).toBeUndefined()
    expect(keeper.failure("eve")).toBeUndefined()
  })
})

/** A file of `count` tests, all starting in the session "ada". */
async function fileWith(count: number): Promise<FileDeclarations> {
  return declarationsOf(async () => {
    test.use({ session: "ada" })

    for (let n = 1; n <= count; n++) {
      test(`test ${n}`, async ({ app, screen }) => {
        await app.open("/home")
        await screen.getByRole("heading", { name: "Signed in" }).waitFor()
      })
    }
  })
}

/** Signs in by asking the agent, then confirms it, so the step's recording is kept. */
async function signIn({ app, agent, screen, expect: check }: SessionFixtures) {
  await app.open("/")
  await agent.act("sign in")
  await check(screen.getByRole("heading", { name: "Signed in" })).toBeVisible()
}

function testAt(file: FileDeclarations, index: number) {
  const declared = file.tests[index]

  if (declared === undefined) throw new Error(`no test ${index}`)

  return declared
}

function configWith(model: ReturnType<typeof scripted>): DanwoConfig {
  return { baseUrl, model, sessions: { ada: signIn } }
}

describe("saved sessions in attempts", () => {
  it("sets a session up once, reuses it, and replays its steps after a reset", async () => {
    const cache = await mkdtemp(join(tmpdir(), "danwo-sessions-"))
    const keeper = new SessionKeeper()
    const file = await fileWith(2)
    const attempt = (index: number, config: DanwoConfig) =>
      runAttempt(file, testAt(file, index), {
        id: `test ${index}`,
        config,
        root: process.cwd(),
        env: undefined,
        replay: { kind: "learn", dir: cache },
        recordDir: undefined,
        sessions: keeper,
      })

    try {
      const actor = scripted([(view) => ["click", { ref: ref(view, "button", "Sign in") }]])
      const first = await attempt(0, configWith(actor))
      const second = await attempt(1, configWith(actor))

      expect([first.status, second.status]).toEqual(["passed", "passed"])
      expect(first.notes).toEqual([expect.stringMatching(/^session ada: created \(\d+ steps\)$/)])
      expect(second.notes).toEqual(["session ada: reused"])
      expect(logins).toBe(1)
      expect(actor.doGenerateCalls.length).toBeGreaterThan(0)

      // A reset drops the kept state; the setup runs again, from its recording.
      keeper.invalidate()

      const idle = scripted([])
      const third = await attempt(0, configWith(idle))

      expect(third.status).toBe("passed")
      expect(third.notes).toEqual([expect.stringMatching(/^session ada: created/)])
      expect(logins).toBe(2)
      expect(idle.doGenerateCalls).toHaveLength(0)
    } finally {
      await rm(cache, { recursive: true, force: true })
    }
  }, 60_000)

  it("fails every test of a session whose setup fails, and tries the setup once", async () => {
    let setups = 0
    const keeper = new SessionKeeper()
    const file = await fileWith(2)
    const config: DanwoConfig = {
      baseUrl,
      sessions: {
        ada: async ({ app, screen }) => {
          setups += 1
          await app.open("/")
          await screen.getByRole("button", { name: "Register" }).click({ timeout: 500 })
        },
      },
    }
    const results = []

    for (const [index, declared] of file.tests.entries()) {
      results.push(
        await runAttempt(file, declared, {
          id: `test ${index}`,
          config,
          root: process.cwd(),
          env: undefined,
          replay: { kind: "none" },
          recordDir: undefined,
          sessions: keeper,
        }),
      )
    }

    expect(results.map((r) => r.status)).toEqual(["failed", "failed"])
    expect(results[1]?.error?.message).toMatch(/^session "ada" could not be set up: /)
    expect(setups).toBe(1)
  }, 60_000)
})
