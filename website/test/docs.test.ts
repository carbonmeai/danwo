import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import { copyGuides } from "../src/generator/agent-guides.ts"
import { GUIDES_DIR, readGuide, REPO_ROOT } from "../src/generator/danwo.ts"
import { EXAMPLES, exampleFolders } from "../src/generator/examples.ts"
import {
  CONTENT,
  type Inputs,
  plannedFiles,
  readInputs,
  WEBSITE,
} from "../src/generator/generate.ts"
import {
  MOVED_SECTIONS,
  type PageSource,
  PLAN,
  plannedPages,
  PROVIDER_GUIDE_SECTIONS,
} from "../src/generator/plan.ts"
import { docsSlugs, postSlugs, prerenderedPaths } from "../src/generator/routes.ts"
import { resolveIcon } from "../src/lib/icons.tsx"
import { isFileAddress, markdownPath, slugsOfMarkdown } from "../src/lib/paths.ts"
import { PROVIDERS, SHARED_EMULATOR_FOLDERS } from "../src/lib/providers.ts"

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
  it("lists every guide once, as raw markdown, on the one page for coding agents", () => {
    const guides = readdirSync(GUIDES_DIR)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -".md".length))
    const pages = sources().filter((source) => source.kind === "agent-guides")
    const page = [...files.values()].find(
      (text) => field(text, "source") === '"packages/skill/guides"',
    )
    const links = [...(page ?? "").matchAll(/\]\(\/guides\/([\w-]+)\.md\)/g)].map(
      (match) => match[1] ?? "",
    )

    expect(pages).toHaveLength(1)
    expect(links.toSorted()).toEqual(guides.toSorted())
  })

  it("serves each guide's raw markdown as it is", () => {
    const copied = join(WEBSITE, "public", "guides")

    copyGuides(join(WEBSITE, "public"))

    for (const file of readdirSync(GUIDES_DIR).filter((name) => name.endsWith(".md")))
      expect(readFileSync(join(copied, file), "utf8")).toBe(
        readFileSync(join(GUIDES_DIR, file), "utf8"),
      )
  })

  it("gives each provider's guide at most one provider page", () => {
    const homes = PROVIDERS.flatMap((provider) => provider.guide ?? [])

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

  it("names only icons that exist", () => {
    const names = [
      ...PLAN.map((tab) => tab.icon),
      ...plannedPages().map(({ page }) => page.icon),
    ].filter((icon) => icon !== "" && !icon.startsWith("/"))

    expect(names.filter((icon) => resolveIcon(icon) === undefined)).toEqual([])
  })

  it("names only sections the guides have", () => {
    for (const [topic, headings] of Object.entries(MOVED_SECTIONS))
      for (const heading of headings) expect(readGuide(topic)).toContain(`\n## ${heading}\n`)
  })

  it("gives every section moved off its guide's page exactly one other home", () => {
    const homes = PROVIDERS.flatMap((provider) =>
      provider.guideSection ? [`providers#${provider.guideSection}`] : [],
    )
    const moved = Object.entries(MOVED_SECTIONS).flatMap(([topic, headings]) =>
      headings.map((heading) => `${topic}#${heading}`),
    )

    expect(homes.toSorted()).toEqual(moved.toSorted())
    expect(PROVIDERS.flatMap((provider) => provider.guideSection ?? []).toSorted()).toEqual(
      [...PROVIDER_GUIDE_SECTIONS].toSorted(),
    )
  })

  it("gives every emulator a provider page", () => {
    const folders = readdirSync(join(REPO_ROOT, "packages", "emulators", "src"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && !SHARED_EMULATOR_FOLDERS.includes(entry.name))
      .map((entry) => entry.name)
    const covered = PROVIDERS.flatMap((provider) => provider.emulators)

    expect(covered.toSorted()).toEqual(folders.toSorted())
  })

  it("names only fidelity suites that have a golden", () => {
    for (const suite of PROVIDERS.flatMap((provider) => provider.fidelity ?? []))
      expect(existsSync(join(REPO_ROOT, "fidelity", `${suite}.json`)), suite).toBe(true)
  })

  it("shows every topic of danwo spec on a reference page", () => {
    const shown = sources().flatMap((source) => (source.kind === "reference" ? source.topics : []))

    expect([...inputs.spec.keys()].filter((topic) => !shown.includes(topic))).toEqual([])
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

  it("gives every provider a page with its logo, written to the providers' template", () => {
    for (const provider of PROVIDERS) {
      const page = files.get(join("providers", `${provider.slug}.mdx`)) ?? ""

      expect(field(page, "icon"), provider.slug).toContain(`/icons/${provider.icon}`)

      for (const heading of ["Set up", "Use it in a test", "Faults", "Fidelity"])
        expect(page, `${provider.slug}: ## ${heading}`).toContain(`\n## ${heading}`)
    }
  })

  it("fills the Providers overview with a card for every provider", () => {
    const overview = files.get(join("providers", "index.mdx")) ?? ""

    for (const provider of PROVIDERS)
      expect(overview, provider.slug).toContain(`href="/docs/providers/${provider.slug}"`)
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
    expect(page).toMatch(/^## Locator$/m)
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
    const listing = readFileSync(join(WEBSITE, "public", "icons", "SOURCES.md"), "utf8")

    for (const provider of PROVIDERS)
      expect(listing, provider.icon).toContain(provider.icon.replace(/\..+$/, ""))
  })
})

describe("links to files", () => {
  it("loads raw markdown and text on the site as files, and leaves pages to the router", () => {
    expect(isFileAddress("/guides/ci.md")).toBe(true)
    expect(isFileAddress("/docs/quickstart.md")).toBe(true)
    expect(isFileAddress("/llms.txt")).toBe(true)
    expect(isFileAddress("/docs/coding-agents")).toBe(false)
    expect(isFileAddress("https://example.com/readme.md")).toBe(false)
    expect(isFileAddress(undefined)).toBe(false)
  })
})

describe("links to the docs from outside the website", () => {
  it("points every danwo.dev docs address in the repository at a page the site builds", () => {
    const slugs = new Set(docsSlugs())
    const tracked = execFileSync("git", ["ls-files", "*.md", "*.mdx", "*.ts", "*.tsx", "*.json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
    const broken = tracked.flatMap((file) =>
      [
        ...readFileSync(join(REPO_ROOT, file), "utf8").matchAll(
          /https:\/\/danwo\.dev\/docs\/([\w/-]*[\w-])/g,
        ),
      ]
        .map((match) => match[1] ?? "")
        .filter((slug) => !slugs.has(slug))
        .map((slug) => `${file}: /docs/${slug}`),
    )

    expect(broken).toEqual([])
  })
})
