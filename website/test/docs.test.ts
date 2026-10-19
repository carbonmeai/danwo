import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { GUIDES_DIR, readGuide } from "../src/generator/danwo.ts"
import {
  CONTENT,
  type Inputs,
  plannedFiles,
  readInputs,
  WEBSITE,
} from "../src/generator/generate.ts"
import { PLAN, PROVIDER_GUIDE_SECTIONS } from "../src/generator/plan.ts"
import { docsSlugs, postSlugs, prerenderedPaths } from "../src/generator/routes.ts"
import { markdownPath, slugsOfMarkdown } from "../src/lib/paths.ts"
import { PROVIDERS } from "../src/lib/providers.ts"

/** The planned docs tree, built once from the installed danwo's spec and README. */
let files: Map<string, string>
let inputs: Inputs

beforeAll(() => {
  inputs = readInputs()
  files = plannedFiles(inputs)
})

/** A page's frontmatter field. */
function field(text: string, name: string): string | undefined {
  return new RegExp(`^${name}: (.+)$`, "m").exec(text)?.[1]
}

describe("the docs plan", () => {
  it("gives every guide a page", () => {
    const planned = PLAN.flatMap((folder) =>
      folder.pages.flatMap((page) => (page.source.kind === "guide" ? [page.source.topic] : [])),
    )
    const guides = readdirSync(GUIDES_DIR)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -".md".length))
    const covered = new Set([...planned, ...PROVIDERS.flatMap((provider) => provider.guide ?? [])])

    expect(guides.filter((topic) => !covered.has(topic))).toEqual([])
  })

  it("names only sections the providers guide has", () => {
    const guide = readGuide("providers")

    for (const heading of PROVIDER_GUIDE_SECTIONS) expect(guide).toContain(`\n## ${heading}\n`)
  })

  it("names only pages written for the website that exist", () => {
    const written = PLAN.flatMap((folder) =>
      folder.pages.flatMap((page) => (page.source.kind === "file" ? [page.source.file] : [])),
    )

    expect(written.filter((file) => !existsSync(join(CONTENT, file)))).toEqual([])
  })
})

describe("the docs tree", () => {
  it("gives every page a title, a description and where its text came from", () => {
    const pages = [...files].filter(([path]) => /\.mdx?$/.test(path))

    expect(pages.length).toBeGreaterThan(40)

    for (const [path, text] of pages) {
      expect(field(text, "title"), path).toBeTruthy()
      expect(field(text, "description"), path).toBeTruthy()
      expect(field(text, "source"), path).toBeTruthy()
    }
  })

  it("gives every provider a page with its logo and what the spec says about it", () => {
    for (const provider of PROVIDERS) {
      const page = files.get(join("providers", `${provider.slug}.md`)) ?? ""

      expect(field(page, "icon"), provider.slug).toContain(`/icons/${provider.icon}`)
      expect(page, provider.slug).toMatch(/## (Environment and seed|Test helpers)/)
    }
  })

  it("lists every page in its folder's sidebar order", () => {
    const concepts: unknown = JSON.parse(files.get(join("concepts", "meta.json")) ?? "{}")
    const providers: unknown = JSON.parse(files.get(join("providers", "meta.json")) ?? "{}")

    expect(concepts).toMatchObject({ pages: expect.arrayContaining(["invariants-and-matrix"]) })
    expect(providers).toMatchObject({ pages: PROVIDERS.map((provider) => provider.slug) })
  })

  it("reads the spec topics the reference pages show", () => {
    for (const topic of ["cli", "config", "environments", "errors", "lint"])
      expect(inputs.spec.has(topic)).toBe(true)
  })
})

describe("addresses", () => {
  it("round-trips a page's slug through its markdown address", () => {
    for (const slug of ["", "quickstart", "providers", "concepts/time-travel"]) {
      const segments = markdownPath(slug)
        .replace(/^\/docs\//, "")
        .split("/")

      expect(slugsOfMarkdown(segments).join("/")).toBe(slug)
    }
  })

  it("prerenders every page's markdown copy and every post", () => {
    const paths = prerenderedPaths()

    for (const slug of docsSlugs()) expect(paths).toContain(markdownPath(slug))
    for (const slug of postSlugs("blog")) expect(paths).toContain(`/blog/${slug}`)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe("the logos", () => {
  it("are all in the website's public folder", () => {
    const icons = PROVIDERS.flatMap((provider) => [provider.icon, provider.iconDark ?? []]).flat()

    for (const icon of icons)
      expect(existsSync(join(WEBSITE, "public", "icons", icon)), icon).toBe(true)
  })

  it("say where each came from", () => {
    const sources = readFileSync(join(WEBSITE, "public", "icons", "SOURCES.md"), "utf8")

    for (const provider of PROVIDERS)
      expect(sources, provider.icon).toContain(provider.icon.replace(/\..+$/, ""))
  })
})
