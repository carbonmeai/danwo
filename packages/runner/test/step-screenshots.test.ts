import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Page } from "playwright-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createSessionFlight } from "../src/flight.ts"
import { type StepRecord, StepRecorder } from "../src/record/index.ts"
import { SecretVault } from "../src/secrets/index.ts"

/**
 * A page that takes a while to screenshot, and whose screenshot fails once a navigation has
 * started, as Playwright's does: "Execution context was destroyed".
 */
class SlowPage {
  navigated = false
  readonly shots: string[] = []

  isClosed = () => false
  locator = () => ({})
  screenshot = async (options: { readonly path: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (this.navigated)
      throw new Error(
        "page.screenshot: Execution context was destroyed, most likely because of a navigation",
      )
    this.shots.push(options.path)
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-step-shots-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A recorder whose steps' screenshots are taken by a flight on `page`, as a session wires them. */
function recorder(page: SlowPage) {
  const ended: { onStep?: (step: StepRecord) => void; pending?: () => Promise<void> } = {}
  const steps = new StepRecorder({
    projectRoot: process.cwd(),
    redact: (text) => text,
    beforeChange: () => ended.pending?.() ?? Promise.resolve(),
    onEnd: (step) => ended.onStep?.(step),
  })
  const flight = createSessionFlight({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the flight reads only these
    page: () => page as unknown as Page,
    vault: new SecretVault({}),
    steps,
    artifactsDir: dir,
    stepScreenshots: true,
  })

  ended.onStep = (step) => flight.onStep(step)
  ended.pending = () => flight.settle()

  return { steps, flight }
}

describe("a step's screenshot", () => {
  it("is taken before the next step navigates away", async () => {
    const page = new SlowPage()
    const { steps, flight } = recorder(page)

    await steps.run("assertion", "expect.toBeVisible", "heading", () => Promise.resolve())
    await steps.run("app", "app.open", "/next", async () => {
      page.navigated = true
      await new Promise((resolve) => setTimeout(resolve, 100))
      page.navigated = false
    })
    await flight.settle()

    expect([...flight.screenshots().values()]).toEqual([
      "screenshots/000-step-0.png",
      "screenshots/001-step-1.png",
    ])
    expect(flight.missing?.()).toEqual([])
  })

  it("does not hold up a check that only reads the page", async () => {
    const page = new SlowPage()
    const { steps, flight } = recorder(page)
    let shotsWhenChecked = -1

    await steps.run("locator", "locator.click", "Save", () => Promise.resolve())
    await steps.run("assertion", "expect.toBeVisible", "Saved", () => {
      shotsWhenChecked = page.shots.length

      return Promise.resolve()
    })
    await flight.settle()

    expect(shotsWhenChecked).toBe(0)
    expect(page.shots).toHaveLength(2)
  })
})
