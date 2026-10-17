/**
 * Relocation: a recorded element that was renamed or moved is found again when one element
 * clearly matches it, the move is noted, and a writable recording is updated. A look-alike makes
 * it unclear, so the step goes back to the model; strict replay never relocates.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { MockLanguageModelV4 } from "ai/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { likeness } from "../src/replay/relocate.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"
import { startToolboxSite, type ToolboxSite } from "./fixtures/toolbox-site.ts"

const SAVE: Move = (view) => ["click", { ref: ref(view, "button", "Save changes") }]

let site: ToolboxSite
let dir: string

beforeAll(async () => {
  site = await startToolboxSite()
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-relocate-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

type Mode = "read-write" | "read-only"

async function withSession<T>(
  options: { model: MockLanguageModelV4; path: string; mode?: Mode } & Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const { path, mode = "read-write", ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    assertionTimeout: 3_000,
    cache: { dir, mode, journey: "relocate" },
    ...rest,
  })

  try {
    await session.app.open(path)

    return await run(session)
  } finally {
    await session.close()
  }
}

/** Saves the billing form and checks it saved, which confirms the step's recording. */
async function save(session: WebSession) {
  const result = await session.agent.act("save the billing details")

  await session.expect(session.screen.getByTestId("status")).toHaveText("Saved")

  return result
}

async function recordSave() {
  await withSession({ model: scripted([SAVE]), path: "/billing" }, save)
}

/** Points the extraction at the account's owner and balance. */
const pointAtAccountFields: Move = (view) => [
  "read",
  {
    fields: [
      { path: "owner", ref: ref(view, "definition", "Ada Lovelace"), as: "text" },
      { path: "balance", ref: ref(view, "definition", "$1,234.50"), as: "number" },
    ],
  },
]

describe("relocation", () => {
  it("finds a renamed button in the same form, notes the move and updates the recording", async () => {
    await recordSave()

    const idle = scripted([])
    const moved = await withSession({ model: idle, path: "/billing?v=2" }, async (session) => {
      const result = await save(session)
      const step = session.flight.steps().find((entry) => entry.api === "agent.act")

      return { result, step }
    })

    expect(moved.result.modelCalls).toBe(0)
    expect(idle.doGenerateCalls).toHaveLength(0)
    expect(moved.step?.cache?.mode).toBe("relocated")
    expect(moved.step?.events).toContainEqual(
      expect.objectContaining({
        kind: "relocated",
        from: 'getByRole("button", name: "Save changes")',
        to: 'getByRole("button", name: "Save all changes")',
      }),
    )

    /* The recording now points at the new name, so an exact replay works without relocating. */
    const exact = await withSession(
      { model: scripted([]), path: "/billing?v=2", mode: "read-only", relocate: false },
      save,
    )

    expect(exact.modelCalls).toBe(0)
  }, 60_000)

  it("hands the step back to the model when a look-alike makes the match unclear", async () => {
    await recordSave()

    const actor = scripted([(view) => ["click", { ref: ref(view, "button", "Save changes now") }]])
    const result = await withSession({ model: actor, path: "/billing?v=3" }, save)

    expect(result.modelCalls).toBeGreaterThan(0)
  }, 60_000)

  it("never relocates under strict replay", async () => {
    await recordSave()

    const idle = scripted([])

    await withSession(
      { model: idle, path: "/billing?v=2", replay: { mode: "strict-stop" } },
      async (session) => {
        await session.agent.act("save the billing details")
        expect(session.divergence()?.reason).toMatch(/no longer on the page/)
      },
    )
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("can be turned off", async () => {
    await recordSave()

    const actor = scripted([(view) => ["click", { ref: ref(view, "button", "Save all changes") }]])
    const result = await withSession({ model: actor, path: "/billing?v=2", relocate: false }, save)

    expect(result.modelCalls).toBeGreaterThan(0)
  }, 60_000)

  it("relocates the fields of an extraction", async () => {
    const schema = z.object({ owner: z.string(), balance: z.number() })

    await withSession({ model: scripted([pointAtAccountFields]), path: "/account" }, (session) =>
      session.agent.extract("owner and balance", schema),
    )

    const idle = scripted([])
    const value = await withSession({ model: idle, path: "/account?v=3" }, (session) =>
      session.agent.extract("owner and balance", schema),
    )

    expect(value).toEqual({ owner: "Ada Lovelace", balance: 1234.5 })
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)
})

describe("likeness", () => {
  it("scores names by the letter pairs they share", () => {
    expect(likeness("Save changes", "save changes")).toBe(1)
    expect(likeness("Save changes", "Save all changes")).toBeGreaterThan(0.8)
    expect(likeness("Save changes", "Subscribe")).toBeLessThan(0.3)
    expect(likeness("", "Save")).toBe(0)
  })
})
