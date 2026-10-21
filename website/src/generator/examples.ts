/**
 * The Examples tab: the repository's `examples/*` projects, each with a card on the overview and
 * a page of its own that shows how to run it and its main test. What a project is comes from its
 * own `package.json`; what the website says about it beyond that is listed here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { REPO_ROOT } from "./danwo.ts"
import { frontmatter } from "./markdown.ts"

/** What the website says about one example beyond its `package.json`. */
export interface ExampleNotes {
  /** Its folder under `examples/`. */
  readonly folder: string
  /** The docs page's slug under `/docs/examples/`. */
  readonly slug: string
  readonly name: string
  /** The framework's mark under `/icons/`, and the one for dark surfaces when it differs. */
  readonly icon: string
  readonly iconDark?: string
  /** The platform and tools it runs on, for the card. */
  readonly runsOn: string
  /** What it shows danwo doing. */
  readonly shows: readonly string[]
  /** The test file the page prints. */
  readonly test: string
  /** The page that explains what this example leans on. */
  readonly guide: { readonly title: string; readonly href: string }
}

export const EXAMPLES: readonly ExampleNotes[] = [
  {
    folder: "shop",
    slug: "shop",
    name: "Shop",
    icon: "nodejs.svg",
    runsOn: "A Node web app in Chromium",
    shows: [
      "Stripe Checkout and its webhook through the Stripe emulator, with no app code changes",
      "An invariant: the credits granted equal the credits Stripe was paid for",
      "`danwo matrix` breaking the purchase with a duplicated webhook",
      "Snapshots and restores between matrix runs, so no run restarts the app",
    ],
    test: "tests/buy-credits.danwo.ts",
    guide: { title: "Fault matrix", href: "/docs/fault-matrix" },
  },
  {
    folder: "shop-mobile",
    slug: "shop-mobile",
    name: "Shop on Android",
    icon: "expo.svg",
    iconDark: "expo-on-dark.svg",
    runsOn: "An Expo app on an Android emulator",
    shows: [
      "The same Stripe emulator behind an Android emulator bound to danwo's proxy",
      "Checkout in a Custom Tab, read with the same locators as the app",
      "Agent steps recorded once and replayed with no model",
      "Parallel emulators, one per worker",
    ],
    test: "tests/buy-credits.danwo.ts",
    guide: { title: "Mobile", href: "/docs/mobile" },
  },
  {
    folder: "shop-playwright",
    slug: "shop-playwright",
    name: "Shop with Playwright",
    icon: "playwright.svg",
    runsOn: "Playwright Test in Chromium",
    shows: [
      "An existing Playwright test given danwo's emulators and flight record",
      "The invariant declared with `test.invariant`",
      "`danwo-playwright matrix` running the fault matrix over a Playwright test",
    ],
    test: "tests/buy-credits.spec.ts",
    guide: { title: "Playwright Test", href: "/docs/playwright" },
  },
]

const PackageSchema = z.object({
  name: z.string(),
  description: z.string(),
  scripts: z.record(z.string(), z.string()).default({}),
})

/** The `examples/*` folders of the repository, leaving out hidden ones such as tests' `.work-*` copies. */
export function exampleFolders(): string[] {
  const root = join(REPO_ROOT, "examples")

  return readdirSync(root)
    .filter((name) => !name.startsWith(".") && statSync(join(root, name)).isDirectory())
    .toSorted()
}

/** One example's `package.json`. */
function packageOf(example: ExampleNotes): z.infer<typeof PackageSchema> {
  const text = readFileSync(join(REPO_ROOT, "examples", example.folder, "package.json"), "utf8")

  return PackageSchema.parse(JSON.parse(text))
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

/** The overview: a card per example and how to run any of them. */
export function examplesIndex(): string {
  const cards = EXAMPLES.map((example) => {
    const description = packageOf(example).description

    return `  <Card title=${JSON.stringify(example.name)} href="/docs/examples/${example.slug}" icon={${mark(example, 24)}}>\n    ${description}\n\n    **Runs on:** ${example.runsOn}\n  </Card>`
  })

  return [
    frontmatter({
      title: "Example projects",
      description:
        "Small apps in the repository that danwo tests itself against, each showing a part of danwo end to end.",
      icon: "FolderOpen",
      section: "Examples",
      source: "examples",
    }),
    "## Pick an example",
    `<Cards>\n${cards.join("\n")}\n</Cards>`,
    "## Run an example",
    "Every example is a workspace of the danwo repository. Install once at the root, then run its scripts from its folder:",
    "```sh\nbun install\ncd examples/shop\nbun run test:e2e   # danwo test\nbun run matrix     # danwo matrix tests/buy-credits.danwo.ts\nnpx @danwo/cli serve # the dashboard over what they recorded\n```",
    "Each page below says what the example needs beyond that, such as an Android emulator.",
    "",
  ].join("\n\n")
}

/** The scripts of a package as a code block, with what each runs. */
function scriptsBlock(scripts: Readonly<Record<string, string>>): string {
  const width = Math.max(...Object.keys(scripts).map((name) => name.length))
  const lines = Object.entries(scripts).map(
    ([name, command]) => `bun run ${name.padEnd(width)}   # ${command}`,
  )

  return `\`\`\`sh\n${lines.join("\n")}\n\`\`\``
}

/** One example's page. */
export function examplePage(example: ExampleNotes): string {
  const pkg = packageOf(example)
  const code = readFileSync(join(REPO_ROOT, "examples", example.folder, example.test), "utf8")

  return [
    frontmatter({
      title: example.name,
      description: pkg.description,
      icon: exampleIcon(example),
      section: "Examples",
      source: `examples/${example.folder}`,
    }),
    "## What it shows",
    example.shows.map((line) => `- ${line}`).join("\n"),
    "## Run it",
    `From \`examples/${example.folder}\`, after \`bun install\` at the repository's root:`,
    scriptsBlock(pkg.scripts),
    `[${example.guide.title}](${example.guide.href}) explains what this example leans on.`,
    "## The test",
    `\`\`\`ts title=${JSON.stringify(example.test)}\n${code.trimEnd()}\n\`\`\``,
    "",
  ].join("\n\n")
}
