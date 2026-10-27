/**
 * The docs in Simplified Chinese: each translated page keeps its English page's shape (headings,
 * anchors, code and links), so a translation cannot quietly drift from the page it translates,
 * and the docs tree, addresses and language helpers serve both languages.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { CONTENT, plannedFiles, readInputs } from "../src/generator/generate.ts"
import { PLAN } from "../src/generator/plan.ts"
import { prerenderedPaths } from "../src/generator/routes.ts"
import { ZH_SECTIONS, ZH_TABS } from "../src/generator/zh.ts"
import { counterpart, docsPath, langOf } from "../src/lib/i18n.ts"
import { markdownPath } from "../src/lib/paths.ts"

/**
 * Every Chinese page written for the website, by its path under `content/docs` in forward slashes,
 * as the plan names pages on every system.
 */
const CHINESE = readdirSync(CONTENT, { recursive: true, encoding: "utf8" })
  .filter((name) => name.endsWith(".zh-CN.mdx"))
  .map((name) => name.split(sep).join("/"))

const text = (file: string) => readFileSync(join(CONTENT, file), "utf8")
const english = (file: string) => file.replace(/\.zh-CN\.mdx$/, ".mdx")

/** The lines outside fenced code, and the fenced blocks' bodies. */
function split(page: string): { prose: string[]; code: string[] } {
  const prose: string[] = []
  const code: string[] = []
  let block: string[] | undefined

  for (const line of page.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (block) {
        code.push(block.join("\n"))
        block = undefined
      } else block = []
    } else if (block) block.push(line)
    else prose.push(line)
  }

  return { prose, code }
}

/** A heading's anchor as the site makes it: its `[#id]`, else its text slugged. */
function anchor(heading: string, seen: Map<string, number>): string {
  const own = /\[#([^\]]+)]\s*$/.exec(heading)?.[1]

  if (own) return own

  const base = heading
    .replace(/^#+\s+/, "")
    .replace(/`([^`]*)`/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-")
  const count = seen.get(base) ?? 0

  seen.set(base, count + 1)

  return count === 0 ? base : `${base}-${count}`
}

/** Each heading's level and anchor, in order. */
function headings(page: string): string[] {
  const seen = new Map<string, number>()

  return split(page)
    .prose.filter((line) => /^#{2,6}\s/.test(line))
    .map((line) => `${/^#+/.exec(line)?.[0].length} ${anchor(line, seen)}`)
}

/** Every link target in a page: markdown links and `href` props. */
function links(page: string): string[] {
  const prose = split(page).prose.join("\n")
  const targets = [
    ...[...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ""),
    ...[...prose.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? ""),
  ]

  return [...new Set(targets)].toSorted()
}

describe("the Chinese docs", () => {
  it("name every tab and every sidebar section in Chinese", () => {
    for (const tab of PLAN) {
      expect(ZH_TABS[tab.dir], tab.dir).toBeDefined()
      for (const group of tab.sections) expect(ZH_SECTIONS[group.title], group.title).toBeDefined()
    }
  })

  it("translate only pages the docs have, each titled and described in Chinese", () => {
    const planned = PLAN.flatMap((tab) =>
      tab.sections.flatMap((group) =>
        group.pages.flatMap((page) => (page.source.kind === "file" ? [page.source.file] : [])),
      ),
    )

    expect(CHINESE.length).toBeGreaterThanOrEqual(6)

    for (const file of CHINESE) {
      expect(planned, file).toContain(english(file))
      expect(text(file), file).toMatch(/^---\ntitle: \S[\s\S]*?\ndescription: \S[\s\S]*?\n---\n/)
    }
  })

  it("keep each English page's headings, with the English anchors, so links into them still land", () => {
    for (const file of CHINESE)
      expect(headings(text(file)), file).toEqual(headings(text(english(file))))
  })

  it("keep each English page's code as it is", () => {
    for (const file of CHINESE)
      expect(split(text(file)).code, file).toEqual(split(text(english(file))).code)
  })

  it("link to the same pages as the English", () => {
    for (const file of CHINESE) expect(links(text(file)), file).toEqual(links(text(english(file))))
  })

  it("are built beside the English pages, in Chinese sections, with a Chinese sidebar", () => {
    const files = plannedFiles(readInputs())
    const quickstart = files.get(join("(documentation)", "quickstart.zh-CN.mdx")) ?? ""

    expect(quickstart).toContain("title: 快速开始")
    expect(quickstart).toContain('section: "入门"')
    expect(quickstart).toContain('source: "website/content/docs/quickstart.zh-CN.mdx"')

    const meta: unknown = JSON.parse(files.get(join("(documentation)", "meta.zh-CN.json")) ?? "{}")

    expect(meta).toMatchObject({ title: "文档", root: true })
    expect(JSON.stringify(meta)).toContain("---入门---")
  })

  it("are prerendered with their markdown copies, every page of the docs in Chinese", () => {
    const paths = prerenderedPaths()

    expect(paths).toContain("/zh-CN/docs")
    expect(paths).toContain("/zh-CN/docs/quickstart")
    expect(paths).toContain(markdownPath("quickstart", "zh-CN"))
    expect(markdownPath("quickstart", "zh-CN")).toBe("/zh-CN/docs/quickstart.md")
  })
})

describe("the docs' languages", () => {
  it("put Chinese pages under /zh-CN and switch between a page's two addresses", () => {
    expect(docsPath("/docs/quickstart", "zh-CN")).toBe("/zh-CN/docs/quickstart")
    expect(docsPath("/docs/quickstart", "en")).toBe("/docs/quickstart")
    expect(langOf("/zh-CN/docs/ci")).toBe("zh-CN")
    expect(langOf("/docs/ci")).toBe("en")
    expect(langOf("/zh-CNx")).toBe("en")
    expect(counterpart("/zh-CN/docs/ci", "en")).toBe("/docs/ci")
    expect(counterpart("/docs/ci", "zh-CN")).toBe("/zh-CN/docs/ci")
  })
})
