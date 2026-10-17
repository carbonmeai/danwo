/**
 * `toHaveScreenshot`: a baseline is written on the first run and matched after; a change fails
 * with the baseline, the new picture and a diff kept for the report; masks hide what changes on
 * every load; a tolerance lets small differences through; `update` rewrites or refuses baselines.
 */
import { once } from "node:events"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listeningPort } from "@danwo/emulators"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"

let colour = "#2255aa"
let width = 200
let server: Server
let baseUrl: string
let dir: string

const page = () => `<!doctype html><title>Badge</title>
<style>body{margin:0;font:16px sans-serif} .badge{width:${width}px;height:60px;background:${colour}}</style>
<div class="badge" data-testid="badge"></div>
<p data-testid="clock">${Date.now()}</p>`

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(page())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
})

afterAll(() => {
  server.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-visual-"))
  colour = "#2255aa"
  width = 200
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function withSession(
  run: (session: WebSession) => Promise<void>,
  options: Partial<WebSessionOptions> = {},
): Promise<WebSession> {
  const session = await openWebSession({
    baseUrl,
    assertionTimeout: 1_500,
    artifactsDir: join(dir, "artifacts"),
    screenshots: { dir: join(dir, "baselines") },
    ...options,
  })

  try {
    await session.app.open("/")
    await run(session)
  } finally {
    await session.close()
  }

  return session
}

function screenshotEvents(session: WebSession) {
  return session.flight
    .steps()
    .flatMap((step) => step.events.filter((event) => event.kind === "screenshot"))
}

describe("toHaveScreenshot", () => {
  it("writes a missing baseline, then matches it", async () => {
    const first = await withSession((session) =>
      session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
    )

    expect(screenshotEvents(first)).toEqual([
      expect.objectContaining({ outcome: "written", name: "badge" }),
    ])
    expect((await stat(join(dir, "baselines", "badge.png"))).size).toBeGreaterThan(0)

    const second = await withSession((session) =>
      session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
    )

    expect(screenshotEvents(second)).toEqual([expect.objectContaining({ outcome: "matched" })])
  }, 60_000)

  it("fails on a change and keeps the baseline, the new picture and a diff", async () => {
    await withSession((session) =>
      session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
    )
    colour = "#aa2255"

    let failure: unknown
    const session = await withSession(async (opened) => {
      failure = await opened
        .expect(opened.screen.getByTestId("badge"))
        .toHaveScreenshot("badge")
        .catch((error: unknown) => error)
    })

    expect(String(failure)).toMatch(
      /expect\(getByTestId\("badge"\)\)\.toHaveScreenshot\("badge"\) failed: \d+ pixels \(100\.00%\) differ/,
    )
    expect(screenshotEvents(session)).toEqual([
      expect.objectContaining({
        outcome: "differs",
        baseline: "screenshots/compare-1-baseline.png",
        actual: "screenshots/compare-1-actual.png",
        diff: "screenshots/compare-1-diff.png",
      }),
    ])
    expect((await readdir(join(dir, "artifacts", "screenshots"))).toSorted()).toEqual([
      "compare-1-actual.png",
      "compare-1-baseline.png",
      "compare-1-diff.png",
    ])
  }, 60_000)

  it("says when the size changed", async () => {
    await withSession((session) =>
      session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
    )
    width = 240

    await withSession(async (session) => {
      await expect(
        session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
      ).rejects.toThrow(/the size changed: 200x60 expected, 240x60 taken/)
    })
  }, 60_000)

  it("paints over masked elements, so what changes on every load does not count", async () => {
    const check = (session: WebSession) =>
      session
        .expect(session.screen)
        .toHaveScreenshot("page", { mask: [session.screen.getByTestId("clock")] })

    await withSession(check)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const again = await withSession(check)

    expect(screenshotEvents(again)).toEqual([expect.objectContaining({ outcome: "matched" })])
  }, 60_000)

  it("lets a difference within maxDiffPixelRatio through", async () => {
    await withSession((session) => session.expect(session.screen).toHaveScreenshot("page"))
    colour = "#2255ab"

    const close = await withSession((session) =>
      session.expect(session.screen).toHaveScreenshot("page", {
        mask: [session.screen.getByTestId("clock")],
        maxDiffPixelRatio: 0.5,
      }),
    )

    expect(screenshotEvents(close)).toEqual([expect.objectContaining({ outcome: "matched" })])
  }, 60_000)

  it("rewrites every baseline with update all, and refuses to write one with update none", async () => {
    await withSession((session) =>
      session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
    )
    colour = "#aa2255"

    const rewritten = await withSession(
      (session) => session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("badge"),
      { screenshots: { dir: join(dir, "baselines"), update: "all" } },
    )

    expect(screenshotEvents(rewritten)).toEqual([expect.objectContaining({ outcome: "written" })])

    await withSession(
      async (session) => {
        await expect(
          session.expect(session.screen.getByTestId("badge")).toHaveScreenshot("other"),
        ).rejects.toThrow(/no baseline for getByTestId\("badge"\)/)
      },
      { screenshots: { dir: join(dir, "baselines"), update: "none" } },
    )
  }, 60_000)
})
