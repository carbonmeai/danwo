/**
 * Controls with no name, such as a clickable `div` holding only an SVG icon: the agent's view
 * carries the icon their markup names, the agent acts on them by ref, the recording finds them
 * again by icon with no model, and those with no icon either are counted as what only a
 * screenshot shows. A page with no such controls reads exactly as its accessibility tree.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MockLanguageModelV4 } from "ai/test"
import { type Browser, chromium, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openWebSession } from "../src/index.ts"
import { registerIconEngine } from "../src/snapshot/icons.ts"
import { viewPage } from "../src/snapshot/view.ts"
import { visualGaps } from "../src/vision/screen.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"
import { scripted } from "./fixtures/scripted.ts"

const SVG = `<svg width="16" height="16"><path d="M0 0h16v16z"/></svg>`
const POINTER = `style="cursor:pointer;display:inline-block;width:16px;height:16px"`

/** Rows of invoices, each with an edit and a delete control that hold only an icon. */
const INVOICES = `<!doctype html><title>Invoices</title>
<ul>${[42, 43, 44]
  .map(
    (n) =>
      `<li>Invoice ${n} <div class="act" ${POINTER}><svg class="lucide lucide-pencil" width="16" height="16"><path d="M0 0h16v16z"/></svg></div> <div class="act" ${POINTER}><svg class="lucide lucide-trash-2" width="16" height="16"><path d="M0 0h16v16z"/></svg></div></li>`,
  )
  .join("")}</ul>
<p id="said">No invoice deleted</p>
<script>
  document.querySelectorAll("li").forEach((row) => {
    row.lastElementChild.addEventListener("click", () => {
      document.getElementById("said").textContent = "Deleted " + row.firstChild.textContent.trim()
      row.remove()
    })
  })
</script>`

/** The ways markup names an icon, and a control that names none. */
const KINDS = `<!doctype html><title>Kinds</title>
<button type="button"><i class="fa-solid fa-gear"></i></button>
<button type="button"><svg width="16" height="16"><use href="#icon-bell"/></svg></button>
<span role="button" data-icon="star" ${POINTER}>${SVG}</span>
<a href="/home"><img src="/icons/home.svg" alt="" width="16" height="16"></a>
<div ${POINTER}>${SVG}</div>
<button type="button">Save</button>`

/** Named controls only. */
const NAMED = `<!doctype html><title>Named</title>
<button type="button" aria-label="Delete">${SVG}</button><a href="/">Home</a>`

let browser: Browser
let server: HtmlServer
let dir: string

beforeAll(async () => {
  await registerIconEngine()
  browser = await chromium.launch()
  server = await serveHtml((url) => {
    if (url.pathname === "/kinds") return KINDS
    if (url.pathname === "/named") return NAMED
    if (url.pathname === "/rows") return rows(80)

    return INVOICES
  })
  dir = await mkdtemp(join(tmpdir(), "danwo-icons-"))
})

afterAll(async () => {
  await browser.close()
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

/** One row of a dense table, with two unnamed icon controls. */
function row(n: number): string {
  return `<tr><td>Row ${n}</td><td><div ${POINTER}><svg class="lucide lucide-pencil" width="16" height="16"></svg></div><div ${POINTER}><svg class="lucide lucide-trash" width="16" height="16"></svg></div></td></tr>`
}

/** `count` rows of a dense table. */
function rows(count: number): string {
  return `<!doctype html><title>Rows</title><table>${Array.from({ length: count }, (_, n) => row(n)).join("")}</table>`
}

async function pageAt(path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()

  await page.goto(`${server.url}${path}`)

  return page
}

const same = (text: string) => text

describe("the agent's view of an unnamed control", () => {
  it("carries the icon its markup names", async () => {
    const view = await viewPage(await pageAt("/"), same)
    const lines = view.tree.split("\n").filter((line) => line.includes("[cursor=pointer]"))

    expect(lines).toHaveLength(6)
    expect(lines.filter((line) => line.endsWith('[icon="pencil"]'))).toHaveLength(3)
    expect(lines.filter((line) => line.endsWith('[icon="trash 2"]'))).toHaveLength(3)
  })

  it("reads an icon from a class, a use, a data-icon or an image file, and none from bare SVG", async () => {
    const tree = (await viewPage(await pageAt("/kinds"), same)).tree

    for (const icon of ["gear", "bell", "star", "home"]) expect(tree).toContain(`[icon="${icon}"]`)
    expect(tree).toMatch(/- generic \[ref=e\d+\] \[cursor=pointer\]$/m)
    expect(tree).toContain('- button "Save"')
    expect(tree.match(/\[icon=/g)).toHaveLength(4)
  })

  it("leaves a page whose controls all have names exactly as its accessibility tree", async () => {
    const page = await pageAt("/named")
    const raw = await page.ariaSnapshot({ mode: "ai" })

    expect((await viewPage(page, same)).tree).toBe(raw)
  })

  it("adds a few characters per unnamed control, for at most 60 of them", async () => {
    const page = await pageAt("/rows")
    const raw = await page.ariaSnapshot({ mode: "ai" })
    const tree = (await viewPage(page, same)).tree
    const marks = tree.match(/ \[icon="[^"]+"\]/g) ?? []
    const added = tree.length - raw.length

    expect(marks).toHaveLength(60)
    expect(added).toBe(marks.join("").length)
    expect(added / marks.length).toBeLessThanOrEqual(16)
    expect(added / raw.length).toBeLessThan(0.1)
  })
})

describe("what only a screenshot shows", () => {
  it("counts the unnamed controls with no icon, not those the view names by icon", async () => {
    const kinds = await pageAt("/kinds")

    expect(await visualGaps(kinds, "")).toMatchObject({ unnamed: 1 })
    expect(await visualGaps(await pageAt("/"), "")).toMatchObject({ unnamed: 0 })
  })
})

/** The ref of the control with `icon` in the row that names `row`. */
function iconIn(view: string, label: string, icon: string): string {
  const lines = view.split("\n")
  const start = lines.findIndex((line) => line.includes(label))
  const line = lines.slice(start).find((entry) => entry.includes(`[icon="${icon}"]`))
  const found = line === undefined ? undefined : /\[ref=([a-z0-9]+)\]/.exec(line)?.[1]

  if (found === undefined) throw new Error(`no ${icon} control in ${label}`)

  return found
}

/** A model that fails the test if it is called. */
function unused() {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("the model was called on replay")
    },
  })
}

async function deleteInvoice(model: MockLanguageModelV4): Promise<void> {
  const session = await openWebSession({
    baseUrl: server.url,
    model,
    cache: { dir, mode: "read-write", journey: "icons" },
  })

  try {
    await session.app.open("/")
    await session.agent.act("delete invoice 43")
    await session.expect(session.screen.getByText("Deleted Invoice 43")).toBeVisible()
  } finally {
    await session.close()
  }
}

describe("acting on an unnamed control", () => {
  it("clicks it by ref, and replays the recording by its icon with no model", async () => {
    const actor = scripted([(view) => ["click", { ref: iconIn(view, "Invoice 43", "trash 2") }]])

    await deleteInvoice(actor)
    expect(actor.views[0]).toContain('[icon="trash 2"]')
    await deleteInvoice(unused())
  })
})
