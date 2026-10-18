/**
 * Replays must have the effects their recordings had: a replay whose actions all ran but whose
 * save did not persist, or whose provider call never happened, diverges; text that changes on its
 * own does not; outside strict replay the model takes the step over and its run is the new
 * recording; and a step an injected fault changed is compared only up to the fault.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Backend, BackendEvent } from "../src/browser/readiness.ts"
import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { backendMismatch, pageDescriptions, pageEffect } from "../src/replay/effects.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"

const CHECKOUT = "POST api.stripe.com/v1/checkout/sessions"

/** What the app's server does when a note is added; tests change it between runs. */
const app = {
  notes: [] as string[],
  /** Answer 200 without keeping the note. */
  silent: false,
  /** Skip the provider call the save makes. */
  skipCall: false,
  /** What a kept note is shown as, before its text. */
  prefix: "",
  /** The fault the provider call gets, as the matrix would label it. */
  fault: null as string | null,
  calls: [] as BackendEvent[],
}

const PAGE = `<!doctype html><title>Notes</title><h1>Notes</h1>
<label>Note <input name="note"></label>
<button type="button" id="add">Add</button>
<ul></ul>
<p data-testid="saved"></p>
<script>
document.getElementById("add").addEventListener("click", async () => {
  const text = document.querySelector("input").value
  const notes = await (await fetch("/api/add?text=" + encodeURIComponent(text))).json()
  document.querySelector("ul").innerHTML = notes.map((n) => "<li>" + n + "</li>").join("")
  const ref = "ord_" + Math.random().toString(36).slice(2, 14).padEnd(12, "x")
  document.querySelector("p").textContent = "Saved at " + new Date().toTimeString().slice(0, 8) + " (" + ref + ")"
})
</script>`

function added(text: string): string {
  if (!app.skipCall) app.calls.push({ signature: CHECKOUT, fault: app.fault })
  if (!app.silent) app.notes.push(app.prefix + text)

  return JSON.stringify(app.notes)
}

/** The app's backend as the session sees it: the provider calls its server made. */
const backend: Backend = {
  quiet: async () => {},
  activity: () => ({ calls: [...app.calls], deliveries: [] }),
}

const ADD: readonly Move[] = [
  (view) => ["fill", { ref: ref(view, "textbox", "Note"), text: "Groceries" }],
  (view) => ["click", { ref: ref(view, "button", "Add") }],
]

let site: HtmlServer
let dir: string

beforeAll(async () => {
  site = await serveHtml((url) => {
    if (url.pathname === "/") return PAGE
    if (url.pathname === "/api/add")
      return {
        status: 200,
        type: "application/json",
        body: added(url.searchParams.get("text") ?? ""),
      }

    return undefined
  })
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-effects-"))
  Object.assign(app, {
    notes: [],
    silent: false,
    skipCall: false,
    prefix: "",
    fault: null,
    calls: [],
  })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** One session on a fresh app: the notes page, the fake backend, a cache in the test's folder. */
async function withSession<T>(
  options: Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  app.notes = []

  const session = await openWebSession({
    baseUrl: site.url,
    backend,
    assertionTimeout: 2_000,
    cache: { dir, mode: "read-write", journey: "notes" },
    ...options,
  })

  try {
    await session.app.open("/")

    return await run(session)
  } finally {
    await session.close()
  }
}

/** Adds the note and confirms it, which keeps the step's recording. */
async function addNote(session: WebSession) {
  await session.agent.act("add a note saying Groceries")
  await session.expect(session.screen.getByRole("listitem")).toHaveText("Groceries")
}

async function record(): Promise<void> {
  await withSession({ model: scripted(ADD) }, addNote)
}

/** A strict replay of the step: its cache note, effect check and divergence. */
async function strictReplay() {
  return withSession({ replay: { mode: "strict-stop" } }, async (session) => {
    await session.agent.act("add a note saying Groceries")

    const step = session.flight.steps().find((s) => s.api === "agent.act")

    return {
      cache: step?.cache,
      effects: step?.events.find((event) => event.kind === "effects"),
      divergence: session.divergence(),
    }
  })
}

async function recording(): Promise<string> {
  const files = await readdir(dir)

  return readFile(join(dir, files[0] ?? ""), "utf8")
}

describe("replayed effects", () => {
  it("records what the step changed on the page and behind it, without run-to-run text", async () => {
    await record()

    const file = await recording()

    expect(file).toContain('"listitem: Groceries"')
    expect(file).toContain(CHECKOUT)
    expect(file).not.toContain("Saved at")
    expect(file).not.toContain("ord_")

    const replayed = await strictReplay()

    expect(replayed.divergence).toBeUndefined()
    expect(replayed.cache).toEqual({ mode: "replayed" })
    expect(replayed.effects).toMatchObject({ result: "matched" })
  }, 60_000)

  it("diverges when the save answers 200 but keeps nothing", async () => {
    await record()
    app.silent = true

    const replayed = await strictReplay()

    expect(replayed.divergence?.reason).toBe(
      "effect: expected listitem: Groceries on the page, saw none",
    )
    expect(replayed.cache).toEqual({ mode: "diverged", because: "effect" })
    expect(replayed.effects).toMatchObject({ result: "diverged" })
  }, 60_000)

  it("diverges when the provider call never happens", async () => {
    await record()
    app.skipCall = true

    const replayed = await strictReplay()

    expect(replayed.divergence?.reason).toBe(`effect: expected ${CHECKOUT}, saw none`)
  }, 60_000)

  it("hands the step to the model outside strict replay, and its run is the new recording", async () => {
    await record()
    app.prefix = "Note: "

    const actor = scripted(ADD)
    const healed = await withSession({ model: actor }, async (session) => {
      await session.agent.act("add a note saying Groceries")
      // The replay added the note before the model took over and added it again.
      await session
        .expect(session.screen.getByRole("listitem").last())
        .toHaveText("Note: Groceries")

      return session.flight.steps().find((s) => s.api === "agent.act")?.cache
    })

    expect(healed).toEqual({ mode: "handed-off", because: "effect", saved: true })
    expect(actor.doGenerateCalls.length).toBeGreaterThan(0)

    const replayed = await strictReplay()

    expect(replayed.divergence).toBeUndefined()
    expect(replayed.effects).toMatchObject({ result: "matched" })
  }, 90_000)

  it("compares a step an injected fault changed only up to the fault", async () => {
    await record()
    app.silent = true
    app.fault = "status 500"

    const replayed = await strictReplay()

    expect(replayed.divergence).toBeUndefined()
    expect(replayed.effects).toMatchObject({ result: "partial" })
    expect(replayed.cache).toEqual({ mode: "replayed" })
  }, 60_000)

  it("replays only the actions of a step that turns effects off", async () => {
    await record()
    app.silent = true

    const replayed = await withSession({ replay: { mode: "strict-stop" } }, async (session) => {
      await session.agent.act("add a note saying Groceries", { effects: false })

      return session.divergence()
    })

    expect(replayed).toBeUndefined()
  }, 60_000)
})

describe("effects", () => {
  const filter = { values: ["ada@danwo.test"], ignore: [/Version \d+/] }

  it("keeps what changed and leaves out clock times, ids, params and ignored text", () => {
    const before = pageDescriptions('- heading "Notes" [ref=e1]\n- paragraph [ref=e2]: Idle')
    const after = pageDescriptions(
      [
        '- heading "Notes" [ref=e1]',
        "- listitem [ref=e3]: Groceries",
        "- paragraph [ref=e4]: Saved at 12:04:55",
        "- paragraph [ref=e5]: Order ord_A1b2C3d4E5f6",
        "- paragraph [ref=e6]: Signed in as ada@danwo.test",
        "- paragraph [ref=e7]: Version 42",
      ].join("\n"),
    )

    expect(pageEffect(before, after, filter)).toEqual({
      appeared: ["listitem: Groceries"],
      vanished: ["paragraph: Idle"],
    })
  })

  it("names missing calls, and extra calls but not webhooks that land late", () => {
    expect(backendMismatch([CHECKOUT], [])).toBe(`expected ${CHECKOUT}, saw none`)
    expect(backendMismatch([], ["GET api.stripe.com/v1/prices"])).toBe(
      "did not expect GET api.stripe.com/v1/prices",
    )
    expect(backendMismatch([], ["webhook checkout.session.completed"])).toBeUndefined()
  })
})
