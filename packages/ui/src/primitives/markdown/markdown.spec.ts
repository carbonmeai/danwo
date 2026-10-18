// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { MarkdownDocument, MarkdownLine } from "./markdown"
import { safeMarkdownUrl, type MarkerPlacement } from "./markdown-tree"

let root: Root
let mount: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mount = document.createElement("div")
  document.body.append(mount)
  root = createRoot(mount)
})
afterEach(async () => {
  await act(async () => root.unmount())
  mount.remove()
  vi.unstubAllGlobals()
})

const render = (element: ReturnType<typeof createElement>) => act(async () => root.render(element))

const memo = [
  "# Investment memo",
  "",
  "Acme is a **strong** buy with _steady_ growth.",
  "",
  "## Summary",
  "",
  "| Metric | Value |",
  "| :--- | ---: |",
  "| Revenue | $12M |",
  "| Margin | ~40% |",
  "",
  "- Recurring revenue",
  "- Low churn",
  "",
  "1. Diligence",
  "2. Close",
  "",
  "> Customers renew at 95%.",
  "",
  "```",
  "const x = 1;",
  "```",
].join("\n")

it("renders headings, a GFM table, lists, emphasis, quotes and code", async () => {
  await render(createElement(MarkdownDocument, { text: memo }))
  expect(mount.querySelector("h1")?.textContent).toBe("Investment memo")
  expect(mount.querySelector("h2")?.textContent).toBe("Summary")
  expect(mount.querySelector("strong")?.textContent).toBe("strong")
  expect(mount.querySelector("em")?.textContent).toBe("steady")
  const cells = [...mount.querySelectorAll("table td")].map((cell) => cell.textContent)

  expect(cells).toEqual(["Revenue", "$12M", "Margin", "~40%"])
  expect(mount.querySelector("th")?.textContent).toBe("Metric")
  expect(mount.querySelector("del")).toBeNull()
  expect(mount.querySelectorAll("ul > li")).toHaveLength(2)
  expect(mount.querySelectorAll("ol > li")).toHaveLength(2)
  expect(mount.querySelector("blockquote")?.textContent).toContain("95%")
  expect(mount.querySelector("pre code")?.textContent).toBe("const x = 1;\n")
})

it("wraps each table in its own sideways-scrolling box that the keyboard can reach", async () => {
  await render(createElement(MarkdownDocument, { text: memo }))

  const box = mount.querySelector("table")?.parentElement

  expect(box?.getAttribute("data-markdown-table")).toBe("")

  expect(box?.getAttribute("role")).toBe("region")

  expect(box?.tabIndex).toBe(0)

  expect(box?.className).toContain("ov-x_auto")
})

it("opens safe links in a new tab and drops unsafe URLs", async () => {
  await render(
    createElement(MarkdownDocument, {
      text: "[site](https://example.com) [mail](mailto:a@example.com) [bad](javascript:alert(1)) [data](data:text/html,x) [local](/settings) ![pixel](https://example.com/p.png)",
    }),
  )
  const links = [...mount.querySelectorAll("a")]

  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://example.com",
    "mailto:a@example.com",
  ])

  for (const link of links) {
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  }

  expect(mount.textContent).toContain("bad")
  expect(mount.querySelector("img")).toBeNull()
  expect(mount.textContent).toContain("pixel")
  expect(safeMarkdownUrl("JavaScript:alert(1)")).toBeNull()
  expect(safeMarkdownUrl("HTTPS://example.com")).toBe("HTTPS://example.com")
})

it("shows raw HTML as literal text instead of rendering it", async () => {
  await render(
    createElement(MarkdownDocument, {
      text: '<script>alert(1)</script>\n\nPress <b onclick="x()">Enter</b> <img src=x onerror=alert(1)>',
    }),
  )
  expect(mount.querySelector("script, b, img, [onclick], [onerror]")).toBeNull()
  expect(mount.textContent).toContain("<script>alert(1)</script>")
  expect(mount.textContent).toContain('<b onclick="x()">Enter</b>')
})

it("keeps plain text as written, including its line breaks", async () => {
  const text = "Retail park, Beaumont TX.\nSecond line"

  await render(createElement(MarkdownDocument, { text }))
  expect(mount.querySelector("p")?.textContent).toBe(text)
  await render(createElement(MarkdownLine, { text: "Plain value: 42 units" }))
  expect(mount.textContent).toBe("Plain value: 42 units")
})

it("previews the first meaningful line inline without block syntax", async () => {
  const cases: Array<[string, string]> = [
    ["# Investment memo\n\nBody", "Investment memo"],
    ["\n\n- **Acme** leads\n- second", "Acme leads"],
    ["| Metric | Value |\n| --- | --- |\n| A | 1 |", "Metric · Value"],
    ["> quoted line\n> more", "quoted line"],
    ["---\n\nAfter the rule", "After the rule"],
    ["first line\nsecond line", "first line"],
  ]

  for (const [text, line] of cases) {
    await render(createElement(MarkdownLine, { text }))
    expect(mount.textContent).toBe(line)
    expect(mount.querySelector("h1, ul, li, table, blockquote, p, a")).toBeNull()
  }

  await render(
    createElement(MarkdownLine, {
      text: "See **bold** and `code` [link](https://x.y)",
    }),
  )
  expect(mount.querySelector("strong")?.textContent).toBe("bold")
  expect(mount.querySelector("code")?.textContent).toBe("code")
  expect(mount.querySelector("a")).toBeNull()
})

it("places citation chips at the offsets chosen in the reading text, inside Markdown", async () => {
  const select = vi.fn()
  const place = vi.fn((plain: string) => [
    [plain.indexOf("$12M") + "$12M".length, [0]] as [number, number[]],
    [plain.indexOf("strong") + "strong".length, [1, 2]] as [number, number[]],
  ])

  await render(
    createElement(MarkdownDocument, {
      text: memo,
      markers: {
        place,
        render: (index: number) =>
          createElement(
            "button",
            { key: index, "data-chip": index, onClick: () => select(index) },
            index + 1,
          ),
      },
    }),
  )
  const plain = place.mock.calls[0]![0]

  expect(plain).toContain("Acme is a strong buy")
  expect(plain).not.toContain("**")
  expect(plain).not.toContain("|")
  const chip = mount.querySelector<HTMLButtonElement>('td [data-chip="0"]')

  expect(chip?.closest("td")?.textContent).toBe("$12M1")
  expect(
    [...mount.querySelectorAll("strong ~ [data-chip], strong [data-chip]")].map((node) =>
      node.getAttribute("data-chip"),
    ),
  ).toEqual(["1", "2"])
  await act(async () => chip?.click())
  expect(select).toHaveBeenCalledWith(0)
})

it("appends unplaced chips after the last text, even for an empty document", async () => {
  const render2 = (text: string) =>
    render(
      createElement(MarkdownDocument, {
        text,
        markers: {
          place: (plain: string): MarkerPlacement[] => [[plain.length, [0]]],
          render: (index: number) => createElement("button", { key: index, "data-chip": index }),
        },
      }),
    )

  await render2("Intro\n\n- last item")
  expect(mount.querySelector('li [data-chip="0"]')).not.toBeNull()
  await render2("")
  expect(mount.querySelector('[data-chip="0"]')).not.toBeNull()
})

const minutes = [
  "# Board Minutes Q2 2026",
  "",
  "## Resolutions",
  "",
  "**SOC 2.** The board ratified the renewal of the SOC 2 Type II report, issued by Coalfire.",
  "",
  "| Framework | Auditor / issuer |",
  "| --- | --- |",
  "| SOC 2 Type II | Coalfire |",
].join("\n")

it("marks a quoted span inside the rendered document, keeping its headings and table", async () => {
  await render(
    createElement(MarkdownDocument, {
      text: minutes,
      highlight: "**SOC 2.** The board ratified the renewal",
    }),
  )
  expect(mount.querySelector("h2")?.textContent).toBe("Resolutions")
  expect(mount.querySelectorAll("table td")).toHaveLength(2)
  expect(mount.textContent).not.toContain("| --- |")
  const marks = [...mount.querySelectorAll("mark[data-cited]")]

  expect(marks.map((mark) => mark.textContent).join("")).toBe(
    "SOC 2. The board ratified the renewal",
  )
  expect(marks[0]?.closest("strong")?.textContent).toBe("SOC 2.")
})

it("marks a quote that runs across table cells, and nothing when it does not match", async () => {
  await render(
    createElement(MarkdownDocument, {
      text: minutes,
      highlight: "SOC 2 Type II | Coalfire",
    }),
  )
  expect(
    [...mount.querySelectorAll("td mark[data-cited]")].map((mark) => mark.textContent),
  ).toEqual(["SOC 2 Type II", "Coalfire"])
  await render(createElement(MarkdownDocument, { text: minutes, highlight: "absent" }))
  expect(mount.querySelector("mark")).toBeNull()
})

it("places chips by an offset in the Markdown source, after the claim ending there", async () => {
  const text = "## Risks\n\n- **Gross margin** was 66%.\n- Coalfire audits SOC 2."
  const claimEnd = text.indexOf("66%") + 3

  await render(
    createElement(MarkdownDocument, {
      text,
      markers: {
        place: (_plain: string, fromSource: (offset: number) => number): MarkerPlacement[] => [
          [fromSource(claimEnd), [0]],
          [fromSource(text.indexOf("margin**") + 6), [1]],
        ],
        render: (index: number) => createElement("button", { key: index, "data-chip": index }),
      },
    }),
  )
  const items = [...mount.querySelectorAll("li")]

  expect(items[0]?.querySelector('[data-chip="0"]')).not.toBeNull()
  expect(items[0]?.innerHTML).toMatch(
    /<span [^>]*data-citation-group="">66%<button data-chip="0"><\/button><\/span>\./,
  )
  expect(items[0]?.querySelector("strong [data-citation-group]")?.innerHTML).toBe(
    'margin<button data-chip="1"></button>',
  )
  expect(items[0]?.querySelector("strong")?.textContent).toBe("Gross margin")
  expect(items[1]?.querySelector("[data-chip]")).toBeNull()
})

it("keeps each chip on the line of the word before it, however the text wraps", async () => {
  const text = "The roof has five years left. It was replaced in 2019."

  await render(
    createElement(MarkdownDocument, {
      text,
      markers: {
        place: (plain: string): MarkerPlacement[] => [
          [plain.indexOf("left.") + "left.".length, [0]],
          [plain.length, [1, 2]],
        ],
        render: (index: number) => createElement("button", { key: index, "data-chip": index }),
      },
    }),
  )
  const groups = [...mount.querySelectorAll("[data-citation-group]")]

  expect(groups.map((group) => group.textContent)).toEqual(["left.", "2019."])
  for (const group of groups) expect(group.className).toContain("white-space_nowrap")
  expect(
    [...groups[1]!.querySelectorAll("[data-chip]")].map((chip) => chip.getAttribute("data-chip")),
  ).toEqual(["1", "2"])
  // The words and spacing around the groups are untouched.
  expect(mount.querySelector("p")?.textContent).toBe(text)
})

it("places a chip with no word before it without a group", async () => {
  await render(
    createElement(MarkdownDocument, {
      text: "Ends with a space ",
      markers: {
        place: (): MarkerPlacement[] => [[0, [0]]],
        render: (index: number) => createElement("button", { key: index, "data-chip": index }),
      },
    }),
  )
  expect(mount.querySelector('[data-chip="0"]')).not.toBeNull()
  expect(mount.querySelector("[data-citation-group]")).toBeNull()
})
