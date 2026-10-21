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
import {
  backendMismatch,
  pageDescriptions,
  pageEffect,
  withoutAnnouncements,
} from "../src/replay/effects.ts"
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
  /** Make the provider call this long after the save, as a queued job would. */
  lateMs: 0,
  calls: [] as BackendEvent[],
  /** How long the route announcer takes to fill after a navigation; never when negative. */
  announceMs: 100,
}

/**
 * A page that navigates on the client, with a route announcer as Next.js adds one: a custom
 * element whose shadow root holds an `alert`, filled with the title some time after.
 */
function routedPage(announceMs: number): string {
  return `<!doctype html><title>Home</title><h1>Home</h1>
<a href="/routed/notes" id="go">All notes</a>
<next-route-announcer></next-route-announcer>
<script>
const host = document.querySelector("next-route-announcer")
const region = document.createElement("div")
region.setAttribute("role", "alert")
region.setAttribute("aria-live", "assertive")
region.id = "__next-route-announcer__"
region.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden"
host.attachShadow({ mode: "open" }).append(region)
document.getElementById("go").addEventListener("click", (event) => {
  event.preventDefault()
  history.pushState({}, "", "/routed/notes")
  document.querySelector("h1").textContent = "All notes"
  document.title = "Acme Notes"
  if (${announceMs} >= 0) setTimeout(() => { region.textContent = document.title }, ${announceMs})
})
</script>`
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
  const call = { signature: CHECKOUT, fault: app.fault }

  if (!app.skipCall && app.lateMs === 0) app.calls.push(call)
  if (!app.skipCall && app.lateMs > 0) setTimeout(() => app.calls.push(call), app.lateMs)
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
    if (url.pathname.startsWith("/routed")) return routedPage(app.announceMs)
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
    lateMs: 0,
    calls: [],
    announceMs: 100,
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
    expect(replayed.cache).toEqual({
      mode: "diverged",
      because: "effect",
      reason: "effect: expected listitem: Groceries on the page, saw none",
    })
    expect(replayed.effects).toMatchObject({ result: "diverged" })
  }, 60_000)

  it("diverges when the provider call never happens", async () => {
    await record()
    app.skipCall = true

    const replayed = await strictReplay()

    expect(replayed.divergence?.reason).toBe(`effect: expected ${CHECKOUT}, saw none`)
  }, 60_000)

  it("waits for a provider call that background work makes seconds after the step", async () => {
    await record()
    app.lateMs = 5_000

    const replayed = await strictReplay()

    expect(replayed.divergence).toBeUndefined()
    expect(replayed.cache).toEqual({ mode: "replayed" })
    expect(replayed.effects).toMatchObject({ result: "matched" })
  }, 60_000)

  it("records a provider call that lands just after the step, so a quicker replay matches", async () => {
    app.lateMs = 950
    await record()
    app.lateMs = 0

    const replayed = await strictReplay()

    expect(JSON.parse(await recording())).toMatchObject({ effects: { backend: [CHECKOUT] } })
    expect(replayed.divergence).toBeUndefined()
    expect(replayed.effects).toMatchObject({ result: "matched" })
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

    expect(healed).toEqual({
      mode: "handed-off",
      because: "effect",
      reason: "effect: expected listitem: Groceries on the page, saw none",
      saved: false,
      recording: "staged",
    })
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

const OPEN: readonly Move[] = [(view) => ["click", { ref: ref(view, "link", "All notes") }]]

/** Opens all notes on the routed page, and how the step went. */
async function openNotes(options: Partial<WebSessionOptions>) {
  const session = await openWebSession({
    baseUrl: site.url,
    backend,
    assertionTimeout: 2_000,
    cache: { dir, mode: "read-write", journey: "routed" },
    ...options,
  })

  try {
    await session.app.open("/routed")
    await session.agent.act("open all notes")
    await session.expect(session.screen.getByRole("heading")).toHaveText("All notes")

    const step = session.flight.steps().find((s) => s.api === "agent.act")

    return { cache: step?.cache, divergence: session.divergence() }
  } finally {
    await session.close()
  }
}

describe("route announcers", () => {
  it("never records what the router announced, so a replay it announces later in matches", async () => {
    await openNotes({ model: scripted(OPEN) })

    const recorded = JSON.parse(await recording())

    expect(recorded.effects.page.appeared).toContain('heading "All notes"')
    expect(JSON.stringify(recorded.effects)).not.toContain("alert")

    app.announceMs = -1

    const replayed = await openNotes({ replay: { mode: "strict-stop" } })

    expect(replayed.divergence).toBeUndefined()
    expect(replayed.cache).toEqual({ mode: "replayed" })
  }, 60_000)

  it("drops live regions holding the title or the announcer's text, and keeps other alerts", () => {
    const descriptions = ["alert: Acme Notes", 'status "Acme Notes"', "alert: Card declined"]

    expect(withoutAnnouncements(descriptions, ["Acme  Notes ", ""])).toEqual([
      "alert: Card declined",
    ])
    expect(withoutAnnouncements(['heading "Acme Notes"'], ["Acme Notes"])).toEqual([
      'heading "Acme Notes"',
    ])
  })
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

  it("leaves out relative times, dates and clock times however the page writes them", () => {
    const volatile = [
      "7 sec. ago",
      "Updated 7s ago",
      "12 mins ago",
      "3 hrs. ago",
      "a minute ago",
      "an hour ago",
      "a few seconds ago",
      "just now",
      "Due in 3 days",
      "Renews in a month",
      "Oct 20",
      "Created Sept. 3",
      "20 October 2026",
      "Today at 3pm",
      "9:41 AM",
      "Sent 10 a.m.",
    ]
    const steady = ["Signed in as Ada", "Assigned to Bob", "3 marks", "Version 2 of the plan"]
    const after = pageDescriptions(
      [...volatile, ...steady].map((text, n) => `- paragraph [ref=e${n}]: ${text}`).join("\n"),
    )

    expect(pageEffect([], after, { values: [], ignore: [] }).appeared).toEqual(
      steady.map((text) => `paragraph: ${text}`),
    )
  })

  it("leaves out result counts, ranges, durations and number-only badges", () => {
    const after = pageDescriptions(
      [
        "- paragraph [ref=e1]: Showing 1 to 9 of 9 results",
        "- paragraph [ref=e2]: Showing 1 to 5 of 5 results in 321ms",
        "- paragraph [ref=e3]: Took 1.2s",
        "- generic [ref=e4]: 11",
        "- status [ref=e5]: 3 records imported",
        "- paragraph [ref=e6]: 1-20 of 143",
        '- button "99+" [ref=e7]',
        "- paragraph [ref=e8]: Rendered in 0.4 s",
        "- paragraph [ref=e9]: 12 matches",
        "- paragraph [ref=e10]: Invoice paid",
        "- paragraph [ref=e11]: 3 seats on the plan",
        "- paragraph [ref=e12]: Step 2 of the guide",
        '- button "Save 2 drafts" [ref=e13]',
      ].join("\n"),
    )

    expect(pageEffect([], after, { values: [], ignore: [] }).appeared).toEqual([
      "paragraph: Invoice paid",
      "paragraph: 3 seats on the plan",
      "paragraph: Step 2 of the guide",
      'button "Save 2 drafts"',
    ])
  })

  it("names missing calls, and extra calls but not webhooks that land late", () => {
    expect(backendMismatch([CHECKOUT], [])).toBe(`expected ${CHECKOUT}, saw none`)
    expect(backendMismatch([], ["GET api.stripe.com/v1/prices"])).toBe(
      "did not expect GET api.stripe.com/v1/prices",
    )
    expect(backendMismatch([], ["webhook checkout.session.completed"])).toBeUndefined()
  })
})
