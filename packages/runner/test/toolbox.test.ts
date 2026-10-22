/**
 * The agent's toolbox: hover menus, uploads, dialogs, new tabs, drag and drop, waits and going
 * back. Each step is recorded with a scripted model, confirmed by a check, and replayed in a
 * fresh session with no model calls.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { MockLanguageModelV4 } from "ai/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession, type WebSession } from "../src/index.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"
import { startToolboxSite, type ToolboxSite } from "./fixtures/toolbox-site.ts"

let site: ToolboxSite
let dir: string
let avatar: string

beforeAll(async () => {
  site = await startToolboxSite()
  dir = await mkdtemp(join(tmpdir(), "danwo-toolbox-"))
  avatar = join(dir, "avatar.png")
  await writeFile(avatar, "not really a png")
})

afterAll(async () => {
  await site.close()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface Scenario {
  readonly journey: string
  readonly instruction: string
  readonly moves: readonly Move[]
  /** The check that confirms the step, run after it in both sessions. */
  readonly check: (session: WebSession) => Promise<void>
  readonly files?: Readonly<Record<string, string>>
}

async function runOnce(
  scenario: Scenario,
  model: MockLanguageModelV4,
  mode: "read-write" | "read-only",
) {
  const session = await openWebSession({
    baseUrl: site.url,
    model,
    assertionTimeout: 3_000,
    cache: { dir: join(dir, "cache"), mode, journey: scenario.journey },
  })

  try {
    await session.app.open("/tools")

    const result = await session.agent.act(scenario.instruction, {
      ...(scenario.files && { files: scenario.files }),
    })

    await scenario.check(session)

    return result
  } finally {
    await session.close()
  }
}

/** Records the scenario with its scripted model, then replays it with a model that must stay unused. */
async function recordAndReplay(scenario: Scenario) {
  const actor = scripted(scenario.moves)
  const recorded = await runOnce(scenario, actor, "read-write")
  const idle = scripted([])
  const replayed = await runOnce(scenario, idle, "read-only")

  return { actor, recorded, replayed, idle }
}

const status = (session: WebSession) => session.screen.getByTestId("status")

describe("the agent's toolbox", () => {
  it("opens a menu on hover and follows it, then replays it", async () => {
    const run = await recordAndReplay({
      journey: "hover",
      instruction: "open the account menu and go to settings",
      moves: [
        (view) => ["hover", { ref: ref(view, "button", "Account") }],
        (view) => ["click", { ref: ref(view, "menuitem", "Settings") }],
      ],
      check: (session) =>
        session.expect(session.screen.getByRole("heading", { name: "Settings" })).toBeVisible(),
    })

    expect(run.actor.views[1]).toContain('menuitem "Settings"')
    expect(run.replayed.modelCalls).toBe(0)
    expect(run.idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("uploads a file the step offers by name, and refuses one it does not", async () => {
    const run = await recordAndReplay({
      journey: "upload",
      instruction: "upload the avatar",
      files: { avatar },
      moves: [(view) => ["upload_file", { ref: ref(view, "button", "Avatar"), files: ["avatar"] }]],
      check: (session) => session.expect(status(session)).toHaveText("Uploaded avatar.png"),
    })

    expect(run.actor.prompts[0]).toContain("Files you may upload: avatar")
    expect(run.replayed.modelCalls).toBe(0)

    const guessing = scripted([
      (view) => ["upload_file", { ref: ref(view, "button", "Avatar"), files: ["passport"] }],
    ])

    await runOnce(
      {
        journey: "upload-unknown",
        instruction: "upload a passport",
        files: { avatar },
        moves: [],
        check: (session) => session.expect(status(session)).toHaveText("Idle"),
      },
      guessing,
      "read-write",
    )
    expect(guessing.prompts[1]).toContain('no file named "passport" is offered; offered: avatar')
  }, 60_000)

  it("answers a confirm dialog the step opens, and replays the answer", async () => {
    const run = await recordAndReplay({
      journey: "confirm",
      instruction: "delete the account",
      moves: [
        (view) => ["click", { ref: ref(view, "button", "Delete account") }],
        () => ["dialog", { accept: true }],
      ],
      check: (session) => session.expect(status(session)).toHaveText("Deleted"),
    })

    expect(run.actor.views[1]).toContain('A confirm dialog blocks the page: "Delete the account?"')
    expect(run.replayed.modelCalls).toBe(0)
  }, 60_000)

  it("types into a prompt dialog", async () => {
    const run = await recordAndReplay({
      journey: "prompt",
      instruction: "rename to Ada",
      moves: [
        (view) => ["click", { ref: ref(view, "button", "Rename") }],
        () => ["dialog", { accept: true, text: "Ada" }],
      ],
      check: (session) => session.expect(status(session)).toHaveText("Renamed to Ada"),
    })

    expect(run.replayed.modelCalls).toBe(0)
  }, 60_000)

  it("dismisses a dialog nobody answers outside an agent step", async () => {
    const session = await openWebSession({ baseUrl: site.url })

    try {
      await session.app.open("/tools")
      await session.screen.getByRole("button", { name: "Delete account" }).click()
      await session.expect(status(session)).toHaveText("Kept")
      expect(await status(session).textContent()).toBe("Kept")
    } finally {
      await session.close()
    }
  }, 60_000)

  it("follows a link into the new tab it opens, and lists the tabs", async () => {
    const run = await recordAndReplay({
      journey: "tab",
      instruction: "open the help centre",
      moves: [(view) => ["click", { ref: ref(view, "link", "Help") }]],
      check: (session) =>
        session.expect(session.screen.getByRole("heading", { name: "Help centre" })).toBeVisible(),
    })

    expect(run.actor.views[1]).toMatch(/Tabs: \[0\] .*\/tools {2}\[1\] .*\/help \(active\)/)
    expect(run.replayed.modelCalls).toBe(0)
  }, 60_000)

  it("drags an item onto a drop zone", async () => {
    const run = await recordAndReplay({
      journey: "drag",
      instruction: "move task A to done",
      moves: [
        (view) => [
          "drag",
          { ref: ref(view, "listitem", "Task A"), to: ref(view, "region", "Done") },
        ],
      ],
      check: (session) => session.expect(status(session)).toHaveText("Dropped Task A"),
    })

    expect(run.replayed.modelCalls).toBe(0)
  }, 60_000)

  it("waits for content that arrives late", async () => {
    const run = await recordAndReplay({
      journey: "wait",
      instruction: "load more",
      moves: [
        (view) => ["click", { ref: ref(view, "button", "Load more") }],
        () => ["wait_for", { text: "More loaded" }],
      ],
      check: (session) => session.expect(status(session)).toHaveText("More loaded"),
    })

    expect(run.replayed.modelCalls).toBe(0)
  }, 60_000)

  it("goes back to the page before", async () => {
    const run = await recordAndReplay({
      journey: "back",
      instruction: "visit settings and come back",
      moves: [() => ["navigate", { url: "/settings" }], () => ["back", {}]],
      check: (session) =>
        session.expect(session.screen.getByRole("heading", { name: "Toolbox" })).toBeVisible(),
    })

    expect(run.replayed.modelCalls).toBe(0)
  }, 60_000)
})

describe("locators for files and drag and drop", () => {
  it("uploads by offered name and drags onto another locator", async () => {
    const session = await openWebSession({ baseUrl: site.url, files: { avatar } })

    try {
      await session.app.open("/tools")
      await session.screen.getByLabel("Avatar").setInputFiles("avatar")
      await session.expect(status(session)).toHaveText("Uploaded avatar.png")
      await session.screen
        .getByText("Task A")
        .dragTo(session.screen.getByRole("region", { name: "Done" }))
      await session.expect(status(session)).toHaveText("Dropped Task A")
      await expect(session.screen.getByLabel("Avatar").setInputFiles("passport")).rejects.toThrow(
        /no file named "passport" is offered; offered: avatar/,
      )
    } finally {
      await session.close()
    }
  }, 60_000)
})
