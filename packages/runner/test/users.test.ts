/**
 * More than one person in a test: `openUser` opens another person's browser beside the test's own,
 * their steps and video are recorded under their name, and their browser tells the app (and the
 * proxy) whose it is through its user agent.
 */
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession } from "../src/index.ts"
import { StepRecorder } from "../src/record/index.ts"
import { startLiveBoard, type LiveBoard } from "./fixtures/live-board.ts"

let board: LiveBoard
let dir: string

beforeAll(async () => {
  board = await startLiveBoard()
  dir = await mkdtemp(join(tmpdir(), "danwo-users-"))
})

afterAll(async () => {
  await board.close()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("another person's browser", () => {
  it("sees what the test's own browser posts, live, with its steps and video under its name", async () => {
    const artifactsDir = join(dir, "attempt")
    const session = await openWebSession({
      baseUrl: board.url,
      assertionTimeout: 5_000,
      artifactsDir,
      record: { stepScreenshots: false, video: true },
    })

    try {
      const bob = await session.openUser("bob")

      await bob.app.open("/")
      await session.app.open("/")
      await session.screen.getByRole("textbox", { name: "Message" }).fill("hello bob")
      await session.screen.getByRole("button", { name: "Post" }).click()
      await bob.expect(bob.screen.getByRole("listitem")).toHaveText("hello bob")
    } finally {
      await session.close()
    }

    const steps = session.flight.steps()
    const bobs = steps.filter((step) => step.user === "bob").map((step) => step.api)

    expect(bobs).toEqual(["app.open", "expect.toHaveText"])
    expect(steps.filter((step) => step.user === undefined).map((step) => step.api)).toEqual([
      "app.open",
      "locator.fill",
      "locator.click",
    ])
    expect(board.agents.some((agent) => agent.endsWith(" danwo-user/bob"))).toBe(true)

    const videos = session.flight.videos?.() ?? []
    const bobsVideo = videos.find((video) => video.user === "bob")

    expect(videos.map((video) => video.file).toSorted()).toEqual([
      "video/bob-tab-1.webm",
      "video/tab-1.webm",
    ])
    expect(bobsVideo?.tab).toBe(1)
    expect((await stat(join(artifactsDir, "video", "bob-tab-1.webm"))).size).toBeGreaterThan(0)
  })

  it("refuses a name that cannot label a person, or one already open", async () => {
    const session = await openWebSession({ baseUrl: board.url })

    try {
      await expect(session.openUser("bob smith")).rejects.toThrow(/not a usable name/)

      const bob = await session.openUser("bob")

      await expect(session.openUser("bob")).rejects.toThrow(/already has a browser open/)
      await bob.close()
      await bob.close()
      await expect(session.openUser("bob")).resolves.toBeDefined()
    } finally {
      await session.close()
    }
  })
})

describe("a person's steps", () => {
  it("go into the attempt's one list, tagged with their name, events on their own step", async () => {
    const steps = new StepRecorder({ projectRoot: process.cwd(), redact: (text) => text })
    const bob = steps.forUser("bob")

    await steps.run("app", "app.open", "/", async () => {
      await bob.run("app", "app.open", "/inbox", async () => {
        steps.event({ kind: "action", at: new Date(0).toISOString(), label: "mine" })
        bob.event({ kind: "action", at: new Date(0).toISOString(), label: "bob's" })
      })
    })

    const [own, bobs] = steps.all()

    expect(own?.user).toBeUndefined()
    expect(own?.events.map((event) => ("label" in event ? event.label : ""))).toEqual(["mine"])
    expect(bobs?.user).toBe("bob")
    expect(bobs?.index).toBe(1)
    expect(bobs?.events.map((event) => ("label" in event ? event.label : ""))).toEqual(["bob's"])
    expect(bob.all()).toHaveLength(2)
  })
})
