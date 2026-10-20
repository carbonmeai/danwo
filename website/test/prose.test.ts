import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import { CONTENT, plannedFiles, readInputs } from "../src/generator/generate.ts"
import { denseParagraphs } from "../src/generator/prose.ts"

/** Every page written for the website, by its path under `content/docs`. */
function writtenPages(dir = CONTENT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) return writtenPages(path)

    return entry.name.endsWith(".mdx") ? [relative(CONTENT, path)] : []
  })
}

/** Each page's dense paragraphs as `page:line (n spans)`, for a readable failure. */
function listing(pages: readonly (readonly [string, string])[]): string[] {
  return pages.flatMap(([page, text]) =>
    denseParagraphs(text).map(({ line, spans }) => `${page}:${line} (${spans} spans)`),
  )
}

describe("dense inline code", () => {
  it("finds a paragraph with more than three code spans, and leaves code blocks and tables alone", () => {
    const page = [
      "Use `a`, `b`, `c` and `d` here.",
      "",
      "| `a` | `b` | `c` | `d` |",
      "",
      "```ts",
      "`a` `b` `c` `d`",
      "```",
      "",
      "- `a` and `b`",
      "- `c` and `d`",
    ].join("\n")

    expect(denseParagraphs(page).map(({ line, spans }) => [line, spans])).toEqual([[1, 4]])
  })

  it("keeps every page written for the website to three code spans a paragraph", () => {
    const pages = writtenPages().map(
      (page) => [page, readFileSync(join(CONTENT, page), "utf8")] as const,
    )

    expect(listing(pages)).toEqual([])
  })

  it("lists generated pages that are still dense, without failing", () => {
    const generated = [...plannedFiles(readInputs())].filter(
      ([path, text]) => /\.mdx?$/.test(path) && !text.includes('source: "website/content/docs/'),
    )
    const dense = listing(generated)

    if (dense.length > 0)
      console.warn(`generated pages with dense inline code:\n${dense.join("\n")}`)

    expect(Array.isArray(dense)).toBe(true)
  }, 60_000)
})
