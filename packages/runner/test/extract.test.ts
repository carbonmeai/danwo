/**
 * `agent.extract`: the model points at elements and the runner reads them, so values come from
 * the page; the result is checked against a zod schema, recorded, and read again on replay with no
 * model call. Under strict replay a field whose element is gone is a divergence.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { MockLanguageModelV4 } from "ai/test"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"
import { startToolboxSite, type ToolboxSite } from "./fixtures/toolbox-site.ts"

const account = z.object({ owner: z.string(), balance: z.number(), autopay: z.boolean() })

const POINT: Move = (view) => [
  "read",
  {
    fields: [
      { path: "owner", ref: ref(view, "definition", "Ada Lovelace"), as: "text" },
      { path: "balance", ref: ref(view, "definition", "$1,234.50"), as: "number" },
      { path: "autopay", ref: ref(view, "checkbox", "Autopay"), as: "boolean" },
    ],
  },
]

let site: ToolboxSite
let dir: string

beforeAll(async () => {
  site = await startToolboxSite()
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-extract-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function withSession<T>(
  options: { model: MockLanguageModelV4; path?: string } & Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const { path = "/account", ...rest } = options
  const session = await openWebSession({
    baseUrl: site.url,
    cache: { dir, mode: "read-write", journey: "extract" },
    ...rest,
  })

  try {
    await session.app.open(path)

    return await run(session)
  } finally {
    await session.close()
  }
}

describe("agent.extract", () => {
  it("reads typed values from the elements the model points at, then replays with no model", async () => {
    const actor = scripted([POINT])
    const first = await withSession({ model: actor }, (session) =>
      session.agent.extract("the account summary", account),
    )

    expect(first).toEqual({ owner: "Ada Lovelace", balance: 1234.5, autopay: true })
    expect(actor.prompts[0]).toContain('"balance":{"type":"number"}')

    const idle = scripted([])
    const again = await withSession(
      { model: idle, cache: { dir, mode: "read-only", journey: "extract" } },
      (session) => session.agent.extract("the account summary", account),
    )

    expect(again).toEqual(first)
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("tells the model why a result does not fit the schema and lets it fix the fields", async () => {
    const actor = scripted([
      (view) => [
        "read",
        {
          fields: [
            { path: "owner", ref: ref(view, "definition", "Ada Lovelace"), as: "text" },
            { path: "balance", ref: ref(view, "definition", "$1,234.50"), as: "text" },
            { path: "autopay", ref: ref(view, "checkbox", "Autopay"), as: "boolean" },
          ],
        },
      ],
      POINT,
    ])
    const value = await withSession({ model: actor }, (session) =>
      session.agent.extract("the account summary", account),
    )

    expect(value.balance).toBe(1234.5)
    expect(actor.doGenerateCalls).toHaveLength(2)
    expect(actor.prompts[1]).toMatch(/That did not work: .*expected number/s)
  }, 60_000)

  it("fails with the model's reason when the page does not show what was asked", async () => {
    const actor = scripted([() => ["fail", { reason: "there is no IBAN on this page" }]])

    await expect(
      withSession({ model: actor }, (session) =>
        session.agent.extract("the IBAN", z.object({ iban: z.string() })),
      ),
    ).rejects.toThrow(/agent\.extract\("the IBAN"\) failed: there is no IBAN on this page/)
  }, 60_000)

  it("diverges under strict replay when a field's element is gone, and acts no further", async () => {
    await withSession({ model: scripted([POINT]) }, (session) =>
      session.agent.extract("the account summary", account),
    )

    const idle = scripted([])

    await withSession(
      { model: idle, path: "/account?v=2", replay: { mode: "strict-stop" } },
      async (session) => {
        await expect(session.agent.extract("the account summary", account)).rejects.toThrow(
          /diverged: getByTestId\("owner"\) is no longer on the page/,
        )
        expect(session.divergence()).toMatchObject({ step: 0, instruction: "the account summary" })

        const later = await session.agent.act("do something else")

        expect(later.modelCalls).toBe(0)
        expect(later.summary).toMatch(/not run: the replay diverged at step 0/)
      },
    )
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)
})
