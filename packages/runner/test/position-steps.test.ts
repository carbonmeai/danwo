/**
 * A step whose meaning is a position replays as the element it found the first time: "open the
 * first invoice" opens the same invoice after a newer one moves to the top. A locator is how a
 * test says a position, and it follows the list.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MockLanguageModelV4 } from "ai/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession, type WebSession } from "../src/index.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"
import { ref, scripted } from "./fixtures/scripted.ts"

/** Whether the list shows a newer invoice above the others. */
let newer = false
let server: HtmlServer
let dir: string

function invoices(): string {
  const numbers = newer ? [43, 42, 41] : [42, 41]
  const items = numbers.map((n) => `<li><a href="/invoice/${n}">Invoice ${n}</a></li>`)

  return `<!doctype html><title>Invoices</title><h1>Invoices</h1><ul>${items.join("")}</ul>`
}

beforeAll(async () => {
  server = await serveHtml((url) => {
    const opened = /^\/invoice\/(\d+)$/.exec(url.pathname)?.[1]

    return opened === undefined
      ? invoices()
      : `<!doctype html><title>Invoice ${opened}</title><h1>Invoice ${opened}</h1>`
  })
  dir = await mkdtemp(join(tmpdir(), "danwo-position-"))
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

/** A model that fails the test if it is called. */
function unused() {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("the model was called on replay")
    },
  })
}

async function inSession(
  model: MockLanguageModelV4,
  run: (session: WebSession) => Promise<void>,
): Promise<void> {
  const session = await openWebSession({
    baseUrl: server.url,
    model,
    cache: { dir, mode: "read-write", journey: "position" },
  })

  try {
    await session.app.open("/")
    await run(session)
  } finally {
    await session.close()
  }
}

describe("a step that means a position", () => {
  it("replays the element it found first, while a locator follows the list", async () => {
    const actor = scripted([(view) => ["click", { ref: ref(view, "link", "Invoice 42") }]])

    await inSession(actor, async (session) => {
      await session.agent.act("open the first invoice")
      await session
        .expect(session.screen.getByRole("heading", { name: "Invoice 42" }))
        .toBeVisible()
    })

    newer = true

    await inSession(unused(), async (session) => {
      const replayed = await session.agent.act("open the first invoice")

      expect(replayed.modelCalls).toBe(0)
      await session
        .expect(session.screen.getByRole("heading", { name: "Invoice 42" }))
        .toBeVisible()
      await session.app.open("/")
      await session.screen.getByRole("listitem").first().getByRole("link").click()
      await session
        .expect(session.screen.getByRole("heading", { name: "Invoice 43" }))
        .toBeVisible()
    })
  })
})
