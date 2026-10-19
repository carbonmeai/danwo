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
import { EXAMPLES, exampleFolders } from "../src/generator/examples.ts"
import {
  type PageSource,
  PLAN,
  plannedPages,
  PROVIDER_GUIDE_SECTIONS,
} from "../src/generator/plan.ts"
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

/** The planned pages' sources. */
function sources(): PageSource[] {
  return plannedPages().map(({ page }) => page.source)
}

describe("the docs plan", () => {
  it("gives every guide exactly one page", () => {
    const planned = sources().flatMap((source) => (source.kind === "guide" ? [source.topic] : []))
    const homes = [...planned, ...PROVIDERS.flatMap((provider) => provider.guide ?? [])]
    const guides = readdirSync(GUIDES_DIR)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -".md".length))

    expect(guides.filter((topic) => !homes.includes(topic))).toEqual([])
    expect(homes.filter((topic, i) => homes.indexOf(topic) !== i)).toEqual([])
  })

  it("puts every provider in exactly one section of the Providers tab", () => {
    const listed = sources().flatMap((source) =>
      source.kind === "provider" ? [source.provider] : [],
    )

    expect(listed.toSorted()).toEqual(PROVIDERS.map((provider) => provider.slug).toSorted())
  })

  it("gives every example folder a page", () => {
    expect(EXAMPLES.map((example) => example.folder).toSorted()).toEqual(exampleFolders())
  })

  it("gives every page a short title and an icon, and slugs unique in their tab", () => {
    for (const { tab, page } of plannedPages()) {
      if (page.source.kind === "provider") continue

      expect(page.title.length, page.slug).toBeLessThanOrEqual(24)
      expect(page.icon, page.slug).toBeTruthy()
      expect(
        tab.sections.flatMap((group) => group.pages).filter((other) => other.slug === page.slug),
      ).toHaveLength(1)
    }
  })

  it("names only sections the providers guide has", () => {
    const guide = readGuide("providers")

    for (const heading of PROVIDER_GUIDE_SECTIONS) expect(guide).toContain(`\n## ${heading}\n`)
  })

  it("names only pages written for the website that exist", () => {
    const written = sources().flatMap((source) => (source.kind === "file" ? [source.file] : []))

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

  it("makes each tab a root folder with its sections as separators", () => {
    const root: unknown = JSON.parse(files.get("meta.json") ?? "{}")

    expect(root).toEqual({ pages: PLAN.map((tab) => tab.dir) })

    for (const tab of PLAN) {
      const meta: unknown = JSON.parse(files.get(join(tab.dir, "meta.json")) ?? "{}")
      const pages = tab.sections.flatMap((group) => [
        `---${group.title}---`,
        ...group.pages.map((page) => page.slug),
      ])

      expect(meta).toMatchObject({ title: tab.title, root: true, pages })
    }
  })

  it("puts each page's section over its title", () => {
    for (const { tab, section: group, page } of plannedPages()) {
      const ext = files.has(join(tab.dir, `${page.slug}.md`)) ? "md" : "mdx"
      const text = files.get(join(tab.dir, `${page.slug}.${ext}`)) ?? ""

      expect(field(text, "section"), page.slug).toBe(JSON.stringify(group.title))
    }
  })

  it("opens a reference page with its example and lists its entries as sections", () => {
    const page = files.get(join("reference", "screen.md")) ?? ""

    expect(page).toContain('```ts title="tests/storefront.danwo.ts"')
    expect(page).toMatch(/^## `Locator`$/m)
    expect(page).toContain("| Member | Description |")
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
