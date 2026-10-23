/**
 * The Examples tab: the repository's `examples/*` projects, each with a card in the gallery and a
 * page of its own that shows how to run it and its main test. What the website says about an
 * example comes from its own `example.json`; its scripts come from its `package.json`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { PROVIDERS } from "../lib/providers.ts"
import { repoUrl, SITE } from "../lib/site.ts"
import { REPO_ROOT } from "./danwo.ts"
import { frontmatter } from "./markdown.ts"

/** An example's `example.json`: what the website says about it. */
const ExampleSchema = z.object({
  name: z.string(),
  /** One sentence on what the app is. */
  summary: z.string(),
  /** The framework's mark under `/icons/`, and the one for dark surfaces when it differs. */
  icon: z.string(),
  iconDark: z.string().optional(),
  /** The frameworks and stores it is built on, shown as badges. */
  stack: z.array(z.string()).min(1),
  /** The providers it emulates, by their docs slug under `/docs/providers/`. */
  providers: z.array(z.string()).min(1),
  /** The platform and tools it runs on, for the card. */
  runsOn: z.string(),
  /** `npm`: a standalone project installed from npm; `workspace`: a workspace of this repository. */
  install: z.enum(["npm", "workspace"]),
  /** `false`: the examples workflow leaves it out, since it needs a device the CI runners lack. */
  ci: z.boolean().optional(),
  /** The language toolchain the examples workflow sets up beside Node, for an app in another language. */
  toolchain: z.enum(["python", "go"]).optional(),
  /** What it shows danwo doing. */
  shows: z.array(z.string()).min(1),
  /** The test file the page prints. */
  test: z.string(),
  /** The page that explains what this example leans on. */
  guide: z.object({ title: z.string(), href: z.string() }),
})

/** One example, as the website shows it. */
export interface ExampleNotes extends z.infer<typeof ExampleSchema> {
  /** Its folder under `examples/`, which is also its page's slug under `/docs/examples/`. */
  readonly folder: string
  readonly slug: string
}

/** The `examples/*` folders of the repository, leaving out hidden ones (tests' `.work-*` copies) and `_kit`. */
export function exampleFolders(): string[] {
  const root = join(REPO_ROOT, "examples")

  return readdirSync(root)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_"))
    .filter((name) => statSync(join(root, name)).isDirectory())
    .toSorted()
}

/** One example's notes, from its `example.json`. */
function notesOf(folder: string): ExampleNotes {
  const text = readFileSync(join(REPO_ROOT, "examples", folder, "example.json"), "utf8")
  const notes = ExampleSchema.parse(JSON.parse(text))
  const unknown = notes.providers.filter((slug) => !PROVIDERS.some((p) => p.slug === slug))

  if (unknown.length > 0) throw new Error(`examples/${folder}: no provider ${unknown.join(", ")}`)

  return { ...notes, folder, slug: folder }
}

/** Every example: the standalone ones first, then the repository's own. */
export const EXAMPLES: readonly ExampleNotes[] = exampleFolders()
  .map(notesOf)
  .toSorted((a, b) => (a.install === b.install ? 0 : a.install === "npm" ? -1 : 1))

const PackageSchema = z.object({
  scripts: z.record(z.string(), z.string()).default({}),
})

/** One example's `package.json` scripts. */
function scriptsOf(example: ExampleNotes): Readonly<Record<string, string>> {
  const text = readFileSync(join(REPO_ROOT, "examples", example.folder, "package.json"), "utf8")

  return PackageSchema.parse(JSON.parse(text)).scripts
}

/** Where the example's folder is on GitHub. */
function exampleSource(example: ExampleNotes): string {
  return `${repoUrl() ?? "https://github.com/carbonmeai/danwo"}/tree/${SITE.branch}/examples/${example.folder}`
}

/** A mark as JSX, shown only in `theme` when one is given. */
function img(file: string, size: number, theme?: string): string {
  return `<img src="/icons/${file}" alt="" width={${size}} height={${size}}${theme ? ` className="only-${theme}"` : ""} />`
}

/** An example's mark as JSX: one image, or one per theme. */
function mark(example: ExampleNotes, size: number): string {
  return example.iconDark
    ? `<>${img(example.icon, size, "light")}${img(example.iconDark, size, "dark")}</>`
    : img(example.icon, size)
}

/** The sidebar icon of an example's page, as the icons plugin reads it. */
export function exampleIcon(example: ExampleNotes): string {
  return [example.icon, example.iconDark]
    .filter((file) => file !== undefined)
    .map((file) => `/icons/${file}`)
    .join("|")
}

/** The providers an example emulates, each linked to its page. */
function providerLinks(example: ExampleNotes): string {
  return example.providers
    .map((slug) => {
      const name = PROVIDERS.find((provider) => provider.slug === slug)?.name ?? slug

      return `[${name}](/docs/providers/${slug})`
    })
    .join(", ")
}

/** The stack as badges. */
function badges(example: ExampleNotes): string {
  return `<Badges items={${JSON.stringify(example.stack)}} />`
}

/** One card of the gallery: what the app is, its stack, what it emulates, and where it lives. */
function card(example: ExampleNotes): string {
  return [
    `  <Card title=${JSON.stringify(example.name)} icon={${mark(example, 24)}}>`,
    `    ${example.summary}`,
    "",
    `    ${badges(example)}`,
    "",
    `    **Emulates:** ${providerLinks(example)} · [Details](/docs/examples/${example.slug}) · [Source](${exampleSource(example)})`,
    "  </Card>",
  ].join("\n")
}

/** The overview: a gallery card per example and how to run either kind. */
export function examplesIndex(): string {
  const standalone = EXAMPLES.filter((example) => example.install === "npm")
  const workspace = EXAMPLES.filter((example) => example.install === "workspace")

  return [
    frontmatter({
      title: "Example projects",
      description:
        "Small apps with a real backend and emulated providers, each tested end to end by danwo with no real keys.",
      icon: "FolderOpen",
      section: "Examples",
      source: "examples",
    }),
    "Each example is a small app with a backend, at least one emulated provider, an invariant that reads the database and the provider, and a fault matrix. None needs a real key or an account.",
    "## Starters",
    "Standalone projects you can copy out of the repository. Each installs danwo from npm.",
    `<Cards>\n${standalone.map(card).join("\n")}\n</Cards>`,
    "## The repository's own",
    "Workspaces of the danwo repository, which its CI tests on every pull request.",
    `<Cards>\n${workspace.map(card).join("\n")}\n</Cards>`,
    "## Run a starter",
    "Copy the folder, install, and run its tests. Each starter's page says what it needs, such as Docker:",
    "```sh\ncd with-next\nnpm install\nnpm test\n```",
    "## Run one of the repository's own",
    "Install once at the root of the repository, then run its scripts from its folder:",
    "```sh\nbun install\ncd examples/shop\nbun run test:e2e\n```",
    "",
  ].join("\n\n")
}

/** The scripts of a package as a code block, with what each runs; npm's `test` as `npm test`. */
function scriptsBlock(runner: string, scripts: Readonly<Record<string, string>>): string {
  const call = (name: string) =>
    runner === "npm run" && name === "test" ? "npm test" : `${runner} ${name}`
  const width = Math.max(...Object.keys(scripts).map((name) => call(name).length))
  const lines = Object.entries(scripts).map(
    ([name, command]) => `${call(name).padEnd(width)}   # ${command}`,
  )

  return `\`\`\`sh\n${lines.join("\n")}\n\`\`\``
}

/** How to run an example: from npm for a starter, from the workspace for the repository's own. */
function runSection(example: ExampleNotes): string[] {
  const scripts = scriptsOf(example)

  if (example.install === "npm")
    return [
      `Copy [\`examples/${example.folder}\`](${exampleSource(example)}) anywhere, then from its folder:`,
      "```sh\nnpm install\nnpm test\n```",
      "Its scripts:",
      scriptsBlock("npm run", scripts),
      "Its README says what else it needs and what the last full matrix found.",
      "Until the danwo version it pins is on npm, install it from a local build instead: from the repository's root, `bun run release <version> --pack`, then `node examples/link.ts " +
        `${example.folder}\`, which installs a copy and prints where it is.`,
    ]

  return [
    `From \`examples/${example.folder}\`, after \`bun install\` at the repository's root:`,
    scriptsBlock("bun run", scripts),
  ]
}

/** One example's page. */
export function examplePage(example: ExampleNotes): string {
  const code = readFileSync(join(REPO_ROOT, "examples", example.folder, example.test), "utf8")

  return [
    frontmatter({
      title: example.name,
      description: example.summary,
      icon: exampleIcon(example),
      section: "Examples",
      source: `examples/${example.folder}`,
    }),
    `${example.summary} [See it on GitHub](${exampleSource(example)}).`,
    "## What it shows",
    example.shows.map((line) => `- ${line}`).join("\n"),
    "## Stack",
    `${badges(example)}\n\n**Emulates:** ${providerLinks(example)}. **Runs on:** ${example.runsOn}.`,
    "## Run it",
    ...runSection(example),
    `[${example.guide.title}](${example.guide.href}) explains what this example leans on.`,
    "## The test",
    `\`\`\`ts title=${JSON.stringify(example.test)}\n${code.trimEnd()}\n\`\`\``,
    "",
  ].join("\n\n")
}
