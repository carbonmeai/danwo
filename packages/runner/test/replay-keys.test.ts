/**
 * What a recording is kept under and what it holds: a route built from a `unique()` value replays
 * on a run with a fresh one.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSession, type WebSessionOptions } from "../src/index.ts"
import { unique } from "../src/replay/params.ts"
import { routeMatches, templateRoute } from "../src/replay/route.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"
import { type Move, ref, scripted } from "./fixtures/scripted.ts"

/** A page that creates a company and moves to its page, its name in the path. */
const PAGE = `<!doctype html><title>Companies</title><h1>Companies</h1>
<label>Company name <input name="company"></label>
<button type="button" id="create">Create</button>
<script>
document.getElementById("create").addEventListener("click", () => {
  const name = document.querySelector("input").value
  history.pushState({}, "", "/companies/" + encodeURIComponent(name))
  document.querySelector("h1").textContent = "Company " + name
})
</script>`

const CREATE: readonly Move[] = [
  (view, conversation) => {
    const name = /"company":\s*"([^"]+)"/.exec(conversation)?.[1] ?? ""

    return ["fill", { ref: ref(view, "textbox", "Company name"), text: name }]
  },
  (view) => ["click", { ref: ref(view, "button", "Create") }],
]

let site: HtmlServer
let dir: string

beforeAll(async () => {
  site = await serveHtml((url) => (url.pathname === "/" ? PAGE : undefined))
})

afterAll(async () => {
  await site.close()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-keys-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** One session with a cache in the test's folder, on the page. */
async function withSession<T>(
  options: Partial<WebSessionOptions>,
  run: (session: WebSession) => Promise<T>,
): Promise<T> {
  const session = await openWebSession({
    baseUrl: site.url,
    assertionTimeout: 2_000,
    cache: { dir, mode: "read-write", journey: "keys" },
    ...options,
  })

  try {
    await session.app.open("/")

    return await run(session)
  } finally {
    await session.close()
  }
}

/** The recordings in the cache folder, parsed. */
async function recordings(): Promise<Record<string, unknown>[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"))

  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8"))))
}

/** Creates the company `name`, a `unique()` value, and checks its page; the step's cache note. */
async function createCompany(options: Partial<WebSessionOptions>, name: string) {
  return withSession(options, async (session) => {
    await session.agent.act("create the company {company}", {
      params: { company: unique(name) },
    })
    await session.expect(session.screen.getByRole("heading")).toHaveText(`Company ${name}`)

    return session.flight.steps().find((step) => step.api === "agent.act")?.cache
  })
}

describe("a unique() value in the route", () => {
  it("is a placeholder in the recorded end route, so a run with a fresh value replays", async () => {
    await createCompany({ model: scripted(CREATE) }, "E2E mu62l6pb9u1v")

    const [recorded] = await recordings()

    expect(recorded).toMatchObject({ endRoute: "app/companies/{company}" })

    const idle = scripted([])
    const cache = await createCompany({ model: idle }, "E2E zq81k0ab3c4d")

    expect(cache).toEqual({ mode: "replayed" })
    expect(idle.doGenerateCalls).toHaveLength(0)
  }, 60_000)

  it("matches the value as typed, percent-encoded, form-encoded or as a slug", () => {
    const values = { name: "Acme k3j9x2" }

    expect(templateRoute("app/companies/Acme%20k3j9x2/edit", values)).toBe(
      "app/companies/{name}/edit",
    )
    expect(templateRoute("app/search/Acme+k3j9x2", values)).toBe("app/search/{name}")
    expect(templateRoute("app/c/acme-k3j9x2", values)).toBe("app/c/{name}")
    expect(templateRoute("acme.test/c/acme-k3j9x2", values)).toBe("acme.test/c/{name}")

    const fresh = { name: "Acme p0q1r2" }

    expect(
      routeMatches("app/companies/Acme%20p0q1r2/edit", "app/companies/{name}/edit", fresh),
    ).toBe(true)
    expect(routeMatches("app/c/acme-p0q1r2", "app/c/{name}", fresh)).toBe(true)
    expect(routeMatches("app/c/acme-k3j9x2", "app/c/{name}", fresh)).toBe(false)
    expect(routeMatches("app/c/acme-p0q1r2", "app/c/{other}", fresh)).toBe(false)
    expect(routeMatches("app/thanks", "app/thanks", fresh)).toBe(true)
  })
})
