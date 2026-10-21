/**
 * Writes the docs tree the site renders, `generated/docs`, from the plan: one folder per tab,
 * each with its sidebar sections in its `meta.json`; guides, README sections and spec topics
 * become markdown pages, and pages written for the website are copied in. Files are only
 * rewritten when their text changed, so the dev server reloads just the pages that did.
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
import { agentGuidesPage } from "./agent-guides.ts"
import { readReadme, readSpec, REPO_ROOT, type SpecSection } from "./danwo.ts"
import { EXAMPLES, examplePage, examplesIndex } from "./examples.ts"
import { frontmatter, referenceBody, section } from "./markdown.ts"
import {
  PLAN,
  type PageSource,
  type PlannedPage,
  type PlannedSection,
  type PlannedTab,
  type ReferenceExample,
  urlDir,
} from "./plan.ts"
import { type ProviderGroup, providerIcon, withProviderCards } from "./provider-pages.ts"

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

/** Where a page sits: what its sidebar entry and its heading say, and the section over it. */
interface Placement {
  readonly title: string
  readonly icon: string
  readonly section: string
}

/** The frontmatter every generated page starts with. */
function head(place: Placement, description: string, source: string): string {
  return frontmatter({
    title: place.title,
    description,
    icon: place.icon,
    section: place.section,
    source,
  })
}

/** A page written for the website, with its place and the file it came from in its frontmatter. */
function copied(file: string, place: Placement): string {
  const text = readFileSync(join(CONTENT, file), "utf8")
  const fields = [
    `title: ${JSON.stringify(place.title)}`,
    `icon: ${JSON.stringify(place.icon)}`,
    `section: ${JSON.stringify(place.section)}`,
    `source: ${JSON.stringify(`website/content/docs/${file}`)}`,
  ]
  const body = text.startsWith("---\n")
    ? text.replace(/^---\n([\s\S]*?)\n---\n/, (_, inner: string) => {
        const kept = inner.split("\n").filter((line) => !/^(title|icon|section|source):/.test(line))

        return `---\n${[...fields, ...kept].join("\n")}\n---\n`
      })
    : text

  return body
}

/** The code a reference page opens with, under a tab naming its file. */
function exampleBlock(example: ReferenceExample): string {
  const text = example.from ? readFileSync(join(REPO_ROOT, example.from), "utf8") : example.code
  const lang = example.file === "terminal" ? "sh" : "ts"

  return `\`\`\`${lang} title=${JSON.stringify(example.file)}\n${(text ?? "").trimEnd()}\n\`\`\``
}

/** The spec sections a reference page shows, narrowed to its entries; a missing topic fails. */
function referenceSections(
  inputs: Inputs,
  source: Extract<PageSource, { kind: "reference" }>,
): SpecSection[] {
  return source.topics.flatMap((topic) => {
    const found = inputs.spec.get(topic)

    if (!found) throw new Error(`danwo spec has no "${topic}" topic for the docs`)
    if (!source.only) return [found]

    const entries = found.entries.filter((entry) => source.only?.(entry.name))

    return entries.length === 0 ? [] : [{ ...found, about: "", entries }]
  })
}

/** A reference page: its description, an example, then the spec's entries. */
function referenceFile(
  place: Placement,
  source: Extract<PageSource, { kind: "reference" }>,
  inputs: Inputs,
): string {
  const parts = [
    head(place, source.description, "packages/skill/src/spec"),
    ...(source.example ? [exampleBlock(source.example)] : []),
    referenceBody(referenceSections(inputs, source)),
  ]

  return `${parts
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim()}\n`
}

/** The Reference overview: a card per reference page, under its section's heading. */
function referenceIndex(place: Placement, tab: PlannedTab): string {
  const groups = tab.sections
    .filter((group) => group.pages.some((page) => page.source.kind === "reference"))
    .map((group) => {
      const cards = group.pages.flatMap((page) =>
        page.source.kind === "reference"
          ? [
              `  <Card title=${JSON.stringify(page.title)} href="/docs/reference/${page.slug}">\n    ${page.source.description}\n  </Card>`,
            ]
          : [],
      )

      return `## ${group.title}\n\n<Cards>\n${cards.join("\n")}\n</Cards>`
    })

  return [
    head(
      place,
      "Every part of danwo's API, config and CLI, generated from the code with `danwo spec`.",
      "packages/skill/src/spec",
    ),
    "Each page is built from `danwo spec`, so it says what the installed danwo exports. A coding agent can read the same with `danwo spec <topic>`.",
    ...groups,
    "",
  ].join("\n\n")
}

/** The Providers tab's sections that hold provider pages, as kinds for its overview. */
function providerKinds(tab: PlannedTab): ProviderGroup[] {
  return tab.sections.flatMap((group) => {
    const slugs = group.pages.flatMap((page) =>
      page.source.kind === "provider" ? [page.source.provider] : [],
    )

    return slugs.length === 0 ? [] : [{ title: group.title, slugs }]
  })
}

/** What building one page needs besides its source. */
interface PageContext {
  readonly place: Placement
  readonly tab: PlannedTab
  readonly inputs: Inputs
}

/** A page's text, and whether it is MDX (cards and other components) or plain markdown. */
type Built = readonly [extension: "md" | "mdx", text: string]

/** How each kind of source becomes a page. */
const BUILDERS: {
  readonly [K in PageSource["kind"]]: (
    source: Extract<PageSource, { kind: K }>,
    context: PageContext,
  ) => Built
} = {
  file: (source, { place }) => ["mdx", copied(source.file, place)],
  "agent-guides": (_, { place }) => ["md", agentGuidesPage(place)],
  readme: (source, { place, inputs }) => [
    "md",
    `${head(place, source.description, "README.md")}\n${section(inputs.readme, source.heading)}\n`,
  ],
  reference: (source, { place, inputs }) => ["md", referenceFile(place, source, inputs)],
  "reference-index": (_, { place, tab }) => ["mdx", referenceIndex(place, tab)],
  providers: (_, { place, tab }) => [
    "mdx",
    withProviderCards(copied("providers/index.mdx", place), providerKinds(tab)),
  ],
  provider: (source, { place }) => ["mdx", copied(`providers/${source.provider}.mdx`, place)],
  examples: () => ["mdx", examplesIndex()],
  example: (source) => {
    const found = EXAMPLES.find((example) => example.slug === source.example)

    if (!found) throw new Error(`no example "${source.example}" for the docs`)

    return ["mdx", examplePage(found)]
  },
}

/** Builds a page from its source with the builder for its kind. */
function build<K extends PageSource["kind"]>(
  source: Extract<PageSource, { kind: K }>,
  context: PageContext,
): Built {
  const builder: (from: Extract<PageSource, { kind: K }>, given: PageContext) => Built =
    BUILDERS[source.kind]

  return builder(source, context)
}

/** A page's file name inside its tab's folder, and its text. */
function pageFile(page: PlannedPage, context: PageContext): [string, string] {
  const [extension, text] = build(page.source, context)

  return [`${page.slug}.${extension}`, text]
}

/** A page's title and icon, which provider pages take from the provider list. */
function placement(page: PlannedPage, group: PlannedSection): Placement {
  if (page.source.kind === "provider") {
    const slug = page.source.provider
    const found = PROVIDERS.find((provider) => provider.slug === slug)

    if (!found) throw new Error(`no provider "${slug}" for the docs`)

    return { title: found.name, icon: providerIcon(found), section: group.title }
  }

  return { title: page.title, icon: page.icon, section: group.title }
}

/**
 * A tab's sidebar: its sections as separators over their pages, the tab marked as a root so it
 * shows as a tab with a sidebar of its own.
 */
function tabMeta(tab: PlannedTab): string {
  const pages = tab.sections.flatMap((group) => [
    `---${group.title}---`,
    ...group.pages.map((page) => page.slug),
  ])
  const value = {
    title: tab.title,
    description: tab.description,
    icon: tab.icon,
    root: true,
    pages,
  }

  return `${JSON.stringify(value, null, 2)}\n`
}

/** Every file of the docs tree, by its path under `OUTPUT`. */
export function plannedFiles(inputs: Inputs): Files {
  const files: Files = new Map()

  files.set("meta.json", `${JSON.stringify({ pages: PLAN.map((tab) => tab.dir) }, null, 2)}\n`)

  for (const tab of PLAN) {
    files.set(join(tab.dir, "meta.json"), tabMeta(tab))

    for (const group of tab.sections)
      for (const page of group.pages) {
        const [file, text] = pageFile(page, { place: placement(page, group), tab, inputs })

        files.set(join(tab.dir, file), text)
      }
  }

  return files
}

/** A page's address under `/docs`, `""` for the docs' home. */
export function pageSlug(tab: PlannedTab, page: PlannedPage): string {
  return [urlDir(tab.dir), page.slug === "index" ? "" : page.slug].filter(Boolean).join("/")
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
