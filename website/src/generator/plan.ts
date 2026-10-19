/**
 * The docs' table of contents: the tabs across the top, the sections of each tab's sidebar, and
 * every page with its short title, its icon and where its text comes from. Most pages are
 * danwo's own guides, README sections and spec topics, so the docs say what `danwo guide` and
 * `danwo spec` say; the rest are written for the website, under `content/docs`.
 */
import { EXAMPLES, exampleIcon } from "./examples.ts"

/** A code sample shown at the top of a reference page, with the file it would live in. */
export interface ReferenceExample {
  /** The tab over the code, such as `tests/checkout.danwo.ts`. */
  readonly file: string
  /** A file of the repository to show, or the code itself. */
  readonly from?: string
  readonly code?: string
}

/** Where a page's text comes from. */
export type PageSource =
  /** A page written for the website, under `content/docs`. */
  | { readonly kind: "file"; readonly file: string }
  /** A `danwo guide`, minus the sections that have pages of their own. */
  | { readonly kind: "guide"; readonly topic: string; readonly drop?: readonly string[] }
  /** One `##` section of the README. */
  | { readonly kind: "readme"; readonly heading: string; readonly description: string }
  /** Topics of `danwo spec`, each entry a section with its members in a table. */
  | {
      readonly kind: "reference"
      readonly topics: readonly string[]
      readonly description: string
      /** Only the entries whose names this keeps, when a topic is split across pages. */
      readonly only?: (name: string) => boolean
      readonly example?: ReferenceExample
    }
  /** The provider pages and their overview, built from the provider list and the spec. */
  | { readonly kind: "providers" }
  /** One provider's page. */
  | { readonly kind: "provider"; readonly provider: string }
  /** The reference overview: a card per reference page. */
  | { readonly kind: "reference-index" }
  /** The example projects and their overview, built from `examples/*`. */
  | { readonly kind: "examples" }
  /** One example project's page. */
  | { readonly kind: "example"; readonly example: string }

/** A page: its slug inside its tab, the short title the sidebar and its heading show, its icon. */
export interface PlannedPage {
  readonly slug: string
  readonly title: string
  /** A Lucide icon name, or a `/icons/...` path (`light|dark` for one per theme). */
  readonly icon: string
  readonly source: PageSource
}

/** A titled group of pages in a tab's sidebar. */
export interface PlannedSection {
  readonly title: string
  readonly pages: readonly PlannedPage[]
}

/** A tab across the top of the docs, with a sidebar of its own. */
export interface PlannedTab {
  /** Its folder under the docs; a `(group)` folder adds nothing to the address. */
  readonly dir: string
  readonly title: string
  readonly description: string
  readonly icon: string
  readonly sections: readonly PlannedSection[]
}

/** A page written for the website. */
function file(slug: string, title: string, icon: string, path = `${slug}.mdx`): PlannedPage {
  return { slug, title, icon, source: { kind: "file", file: path } }
}

/** A page from a guide. */
function guide(
  slug: string,
  title: string,
  icon: string,
  topic = slug,
  drop?: readonly string[],
): PlannedPage {
  return { slug, title, icon, source: { kind: "guide", topic, ...(drop && { drop }) } }
}

/** A reference page from spec topics. */
function reference(
  slug: string,
  title: string,
  icon: string,
  source: Omit<Extract<PageSource, { kind: "reference" }>, "kind">,
): PlannedPage {
  return { slug, title, icon, source: { kind: "reference", ...source } }
}

/** A provider's page; its title and logo come from the provider list. */
function provider(slug: string): PlannedPage {
  return { slug, title: "", icon: "", source: { kind: "provider", provider: slug } }
}

/** Sections of the providers guide that are pages under Providers instead. */
export const PROVIDER_GUIDE_SECTIONS = ["Auth0", "Clerk", "Composio"]

/** The entries of the spec's test API that are about fixtures rather than declaring tests. */
const FIXTURE_TYPES = new Set(["UseOptions", "FixtureSetup", "FixtureDefinitions"])

export const PLAN: readonly PlannedTab[] = [
  {
    dir: "(documentation)",
    title: "Documentation",
    description: "Guides and concepts",
    icon: "BookOpen",
    sections: [
      {
        title: "Get started",
        pages: [
          file("index", "Introduction", "House"),
          file("why-danwo", "Why danwo", "Sparkles"),
          {
            slug: "installation",
            title: "Installation",
            icon: "Download",
            source: {
              kind: "readme",
              heading: "Quickstart",
              description:
                "danwo init sets danwo up in your project: the engine, the model for agent steps, the providers to emulate and the coding agents to teach.",
            },
          },
          guide("first-test", "First test", "Rocket"),
          {
            slug: "coding-agents",
            title: "Coding agents",
            icon: "Bot",
            source: {
              kind: "readme",
              heading: "Coding agents (MCP)",
              description:
                "danwo's MCP server, skill, spec and guides let Claude Code, Cursor and Codex run, explain and write danwo tests.",
            },
          },
        ],
      },
      {
        title: "Core concepts",
        pages: [
          guide("agent-and-locators", "Agent and locators", "MousePointerClick", "locators-vs-agent"),
          file("replay-cache", "Replay cache", "History", "concepts/replay-cache.mdx"),
          guide("emulators", "Emulators", "Server", "providers", PROVIDER_GUIDE_SECTIONS),
          guide("fault-matrix", "Fault matrix", "Grid3x3", "matrix"),
          guide("flight-records", "Flight records", "FileSearch", "debugging"),
        ],
      },
      {
        title: "Writing tests",
        pages: [
          guide("secrets", "Secrets", "KeyRound"),
          guide("email-and-otp", "Email and 2FA codes", "Mail"),
          guide("sessions", "Saved sessions", "UserCheck"),
          guide("time-travel", "Time travel", "Clock", "time"),
          guide("data-faults", "Database and cache", "Database", "infrastructure"),
          guide("integration-lint", "Integration lint", "ShieldCheck", "lint"),
        ],
      },
      {
        title: "Platforms",
        pages: [
          guide("mobile", "Mobile", "Smartphone"),
          guide("playwright", "Playwright Test", "FlaskConical"),
        ],
      },
      {
        title: "Running",
        pages: [
          guide("ci", "CI and GitHub", "GitPullRequest"),
          guide("dashboard", "Dashboard", "LayoutDashboard"),
          guide("fidelity", "Fidelity", "Scale"),
        ],
      },
    ],
  },
  {
    dir: "providers",
    title: "Providers",
    description: "The APIs danwo emulates",
    icon: "Plug",
    sections: [
      {
        title: "Overview",
        pages: [
          { slug: "index", title: "Providers", icon: "Plug", source: { kind: "providers" } },
        ],
      },
      { title: "Payments", pages: ["stripe", "paystack", "flutterwave", "bachs"].map(provider) },
      { title: "Email and messaging", pages: ["resend", "twilio", "slack"].map(provider) },
      {
        title: "Identity and workspace",
        pages: ["google", "microsoft", "github", "auth0", "clerk"].map(provider),
      },
      { title: "Storage and cloud", pages: ["s3", "aws"].map(provider) },
      { title: "AI", pages: ["model-apis", "composio"].map(provider) },
    ],
  },
  {
    dir: "reference",
    title: "Reference",
    description: "API, config and CLI",
    icon: "Code",
    sections: [
      {
        title: "Overview",
        pages: [
          {
            slug: "index",
            title: "Reference",
            icon: "Code",
            source: { kind: "reference-index" },
          },
        ],
      },
      {
        title: "Test API",
        pages: [
          reference("test", "test", "FlaskConical", {
            topics: ["api"],
            only: (name) => !FIXTURE_TYPES.has(name),
            description:
              "Declares tests, their invariants, saved sessions and fresh values; what a `*.danwo.ts` file is built from.",
            example: { file: "tests/buy-credits.danwo.ts", from: "examples/shop/tests/buy-credits.danwo.ts" },
          }),
          reference("fixtures", "Fixtures", "Puzzle", {
            topics: ["api", "fixtures"],
            only: (name) => FIXTURE_TYPES.has(name) || /Fixtures?$/.test(name),
            description:
              "What test bodies receive: the app, the screen and each provider's handle, added with `test.extend`.",
            example: {
              file: "tests/buy-credits.danwo.ts",
              code: `import { type StripeFixtures, test as base } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()

test("buys credits", async ({ app, screen, stripe }) => {
  await app.open("/")
  // stripe reads what the app did at the Stripe emulator
})`,
            },
          }),
          reference("screen", "screen and Locator", "Monitor", {
            topics: ["locators"],
            description:
              "Finding elements the way a user names them, acting on them, and the app and mail handles beside them.",
            example: {
              file: "tests/storefront.danwo.ts",
              from: "examples/shop/tests/storefront.danwo.ts",
            },
          }),
          reference("expect", "expect", "CircleCheck", {
            topics: ["expect"],
            description: "Assertions on locators and pages that wait until they hold or time out.",
            example: {
              file: "tests/checkout.danwo.ts",
              code: `await expect(screen.getByTestId("checkout-total")).toContainText("$5.00")
await expect(screen.getByRole("heading", { name: "Thank you" })).toBeVisible()`,
            },
          }),
          reference("agent", "agent", "Bot", {
            topics: ["agent"],
            description:
              "Plain-English steps: `act`, `assert`, `extract` and `waitFor`, verified and cached for replay.",
            example: {
              file: "tests/upgrade.danwo.ts",
              code: `await agent.act("upgrade the workspace to the Pro plan")
await agent.assert("the invoice preview shows a prorated amount")`,
            },
          }),
          reference("secrets", "Secrets", "KeyRound", {
            topics: ["secrets"],
            description: "Configured secrets, filled by name so the model never sees their values.",
          }),
        ],
      },
      {
        title: "Project",
        pages: [
          reference("config", "Config", "SlidersHorizontal", {
            topics: ["config"],
            description: "`danwo.config.ts`: `defineConfig` and every option.",
            example: { file: "danwo.config.ts", from: "examples/shop/danwo.config.ts" },
          }),
          reference("cli", "CLI", "Terminal", {
            topics: ["cli"],
            description: "Every `danwo` command and its options.",
            example: {
              file: "terminal",
              code: `danwo init
danwo test
danwo matrix tests/buy-credits.danwo.ts
danwo serve --open`,
            },
          }),
          reference("environments", "Environments", "Boxes", {
            topics: ["environments"],
            description: "Starting the app and the emulators a worker's tests run against.",
          }),
          reference("errors", "Errors", "TriangleAlert", {
            topics: ["errors"],
            description: "Every error code a run reports, and what to do about it.",
          }),
          reference("cache", "Cache outcomes", "History", {
            topics: ["cache"],
            description: "What the replay cache did with each recorded step.",
          }),
        ],
      },
      {
        title: "Matrix and lint",
        pages: [
          reference("faults", "Faults", "Zap", {
            topics: ["faults"],
            description: "The fault vocabulary `danwo matrix` plans from.",
          }),
          reference("lint-rules", "Lint rules", "ShieldCheck", {
            topics: ["lint"],
            description: "Every integration lint rule.",
          }),
        ],
      },
      {
        title: "Providers",
        pages: [
          reference("emulator-helpers", "Emulator helpers", "Wrench", {
            topics: ["emulators"],
            description: "Reading what the app did at a provider, or acting as a provider's user.",
          }),
        ],
      },
    ],
  },
  {
    dir: "examples",
    title: "Examples",
    description: "Projects to run",
    icon: "FolderOpen",
    sections: [
      {
        title: "Examples",
        pages: [
          {
            slug: "index",
            title: "Example projects",
            icon: "FolderOpen",
            source: { kind: "examples" },
          },
          ...EXAMPLES.map(
            (example): PlannedPage => ({
              slug: example.slug,
              title: example.name,
              icon: exampleIcon(example),
              source: { kind: "example", example: example.slug },
            }),
          ),
        ],
      },
    ],
  },
]

/** A tab's folder as it shows in addresses: a `(group)` folder shows as nothing. */
export function urlDir(dir: string): string {
  return /^\(.+\)$/.test(dir) ? "" : dir
}

/** Every planned page with its tab and section. */
export function plannedPages(): { tab: PlannedTab; section: PlannedSection; page: PlannedPage }[] {
  return PLAN.flatMap((tab) =>
    tab.sections.flatMap((section) => section.pages.map((page) => ({ tab, section, page }))),
  )
}
