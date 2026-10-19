/**
 * Writes the docs tree the site renders, `generated/docs`, from the plan: guides, README
 * sections and spec topics become markdown pages, pages written for the website are copied in,
 * and each folder gets its sidebar order. Files are only rewritten when their text changed, so
 * the dev server reloads just the pages that did.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative } from "node:path"

import { PROVIDERS } from "../lib/providers.ts"
import { readGuide, readReadme, readSpec, type SpecSection } from "./danwo.ts"
import { frontmatter, guidePage, section, sectionMarkdown, withoutSections } from "./markdown.ts"
import { PLAN, type PageSource, type PlannedFolder, type PlannedPage } from "./plan.ts"
import { providerIndex, providerPage } from "./provider-pages.ts"

/** The website package's folder. */
export const WEBSITE = join(import.meta.dirname, "..", "..")

/** Pages written for the website. */
export const CONTENT = join(WEBSITE, "content", "docs")

/** Where the docs tree is written; the docs collection reads it. */
const OUTPUT = join(WEBSITE, "generated", "docs")

/** What `generateDocs` reads once per run. */
export interface Inputs {
  readonly spec: ReadonlyMap<string, SpecSection>
  readonly readme: string
}

/** A file of the docs tree: its path under `OUTPUT` and its text. */
type Files = Map<string, string>

/** A page written for the website, with the file it came from added to its frontmatter. */
function copied(file: string): string {
  const text = readFileSync(join(CONTENT, file), "utf8")
  const source = `source: ${JSON.stringify(`website/content/docs/${file}`)}`

  return text.startsWith("---\n") ? text.replace("---\n", `---\n${source}\n`) : text
}

/** A guide as a markdown page. */
function guideFile(topic: string, drop: readonly string[] = []): string {
  const page = guidePage(readGuide(topic))

  return `${frontmatter({
    title: page.title,
    description: page.description,
    source: `packages/skill/guides/${topic}.md`,
  })}\n${withoutSections(page.body, drop)}\n`
}

/** The topics of the spec a page shows, in order; a missing topic fails the build. */
function specTopics(inputs: Inputs, topics: readonly string[]): string {
  return topics
    .map((topic) => {
      const found = inputs.spec.get(topic)

      if (!found) throw new Error(`danwo spec has no "${topic}" topic for the docs`)

      return topics.length > 1
        ? `## ${found.title}\n\n${sectionMarkdown(found)}`
        : sectionMarkdown(found, 2)
    })
    .join("\n\n")
}

/** The text of one planned page other than the providers index. */
function pageText(source: Exclude<PageSource, { kind: "providers" }>, inputs: Inputs): string {
  switch (source.kind) {
    case "file":
      return copied(source.file)
    case "guide":
      return guideFile(source.topic, source.drop)
    case "readme":
      return `${frontmatter({ title: source.title, description: source.description, source: "README.md" })}\n${section(inputs.readme, source.heading)}\n`
    default:
      return `${frontmatter({ title: source.title, description: source.description, source: "packages/skill/src/spec" })}\n${specTopics(inputs, source.topics)}\n`
  }
}

/** A folder's sidebar order and title, as the docs collection reads it. */
function meta(folder: PlannedFolder, slugs: readonly string[]): string {
  const value =
    folder.dir === ""
      ? { pages: [...slugs, ...PLAN.filter((other) => other.dir !== "").map((other) => other.dir)] }
      : {
          title: folder.title,
          ...(folder.icon && { icon: folder.icon }),
          ...(folder.defaultOpen && { defaultOpen: true }),
          /* A folder's index page is the folder's own link, not one of its pages. */
          pages: slugs.filter((slug) => slug !== "index"),
        }

  return `${JSON.stringify(value, null, 2)}\n`
}

/** A planned page's files: its own, and for the providers index every provider's page too. */
function pageFiles(
  page: PlannedPage,
  inputs: Inputs,
): [slug: string, file: string, text: string][] {
  if (page.source.kind !== "providers")
    return [
      [
        page.slug,
        `${page.slug}.${page.source.kind === "file" ? "mdx" : "md"}`,
        pageText(page.source, inputs),
      ],
    ]

  return [
    [page.slug, `${page.slug}.mdx`, providerIndex()],
    ...PROVIDERS.map((provider): [string, string, string] => [
      provider.slug,
      `${provider.slug}.md`,
      providerPage(provider, inputs.spec),
    ]),
  ]
}

/** Every file of the docs tree, by its path under `OUTPUT`. */
export function plannedFiles(inputs: Inputs): Files {
  const files: Files = new Map()

  for (const folder of PLAN) {
    const pages = folder.pages.flatMap((page) => pageFiles(page, inputs))

    for (const [, file, text] of pages) files.set(join(folder.dir, file), text)

    files.set(
      join(folder.dir, "meta.json"),
      meta(
        folder,
        pages.map(([slug]) => slug),
      ),
    )
  }

  return files
}

/** What the docs read from danwo: the spec and the README. */
export function readInputs(): Inputs {
  return { spec: readSpec(), readme: readReadme() }
}

/** Every file under `dir`, as paths relative to `OUTPUT`. */
function existing(dir: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    return statSync(path).isDirectory() ? existing(path) : [relative(OUTPUT, path)]
  })
}

/** Writes `text` to `path` under `OUTPUT` unless it already holds it; true when it wrote. */
function writeChanged(path: string, text: string): boolean {
  const target = join(OUTPUT, path)

  if (existsSync(target) && readFileSync(target, "utf8") === text) return false

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)

  return true
}

/** Writes the docs tree; returns how many files changed. */
export function generateDocs(): number {
  const files = plannedFiles(readInputs())
  const written = [...files].filter(([path, text]) => writeChanged(path, text)).length
  const stale = existing(OUTPUT).filter((path) => !files.has(path))

  for (const path of stale) rmSync(join(OUTPUT, path))

  return written + stale.length
}
