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
  /** Some `##` sections of a guide, as a page of their own. */
  | {
      readonly kind: "sections"
      readonly topic: string
      readonly sections: readonly string[]
      readonly description: string
    }
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
  /** The Providers overview, `content/docs/providers/index.mdx` with the card grid filled in. */
  | { readonly kind: "providers" }
  /** One provider's page, `content/docs/providers/<provider>.mdx`, titled from the provider list. */
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

/** A page from some sections of a guide; the guide's own page drops them. */
function sections(
  slug: string,
  title: string,
  icon: string,
  source: {
    readonly topic: string
    readonly keep: readonly string[]
    readonly description: string
  },
): PlannedPage {
  return {
    slug,
    title,
    icon,
    source: {
      kind: "sections",
      topic: source.topic,
      sections: source.keep,
      description: source.description,
    },
  }
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

/**
 * A further page about a provider, written for the website under `content/docs/providers`, with
 * the provider's logo, and its mark for dark surfaces when it has one.
 */
function part(slug: string, title: string, logo: string, dark?: string): PlannedPage {
  const icon = [logo, dark].flatMap((file) => (file ? [`/icons/${file}`] : [])).join("|")

  return file(slug, title, icon, `providers/${slug}.mdx`)
}

/** Sections of the providers guide that are pages under Providers instead. */
export const PROVIDER_GUIDE_SECTIONS = [
  "S3 and Tigris",
  "Stripe",
  "Twilio",
  "Auth0",
  "Clerk",
  "Composio",
  "Nylas",
  "Nango",
  "Unipile",
  "Pusher",
  "Novu",
  "Tiptap",
]

/** Sections of the providers guide on running a real app's services, a page of their own. */
const REAL_STACK_SECTIONS = [
  "Any app, started by its own command",
  "Several apps",
  "Hosts no service answers",
]

/**
 * Every guide section that is shown on a page of its own rather than its guide's page, by guide:
 * the guide's page drops them, and the docs test checks each has exactly one home.
 */
export const MOVED_SECTIONS = {
  providers: [...PROVIDER_GUIDE_SECTIONS, ...REAL_STACK_SECTIONS],
}

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
          file("quickstart", "Quickstart", "Rocket"),
          file("test-a-provider", "Test a provider", "CreditCard"),
        ],
      },
      {
        title: "Coding agents",
        pages: [
          file("coding-agents", "Overview", "Bot", "coding-agents/overview.mdx"),
          file("agent-setup", "Set up your agent", "Settings2", "coding-agents/setup.mdx"),
          file("mcp-tools", "MCP tools", "Wrench", "coding-agents/mcp-tools.mdx"),
          file(
            "fix-with-an-agent",
            "Fix a failure",
            "Stethoscope",
            "coding-agents/fix-a-failure.mdx",
          ),
        ],
      },
      {
        title: "Where danwo runs",
        pages: [
          file("where-danwo-runs", "Overview", "Map", "where-danwo-runs/overview.mdx"),
          file(
            "full-stack-local",
            "Full-stack app",
            "Boxes",
            "where-danwo-runs/full-stack-local.mdx",
          ),
          file(
            "frontend-and-backend",
            "Frontend and backend",
            "Split",
            "where-danwo-runs/frontend-and-backend.mdx",
          ),
          file(
            "frontend-only",
            "Frontend only",
            "MonitorSmartphone",
            "where-danwo-runs/frontend-only.mdx",
          ),
          file("staging", "Staging", "CloudUpload", "where-danwo-runs/staging.mdx"),
          file("production", "Production", "Globe", "where-danwo-runs/production.mdx"),
          file(
            "which-setup",
            "Which should I use?",
            "Signpost",
            "where-danwo-runs/which-setup.mdx",
          ),
        ],
      },
      {
        title: "Core concepts",
        pages: [
          file(
            "agent-and-locators",
            "Agent and locators",
            "MousePointerClick",
            "concepts/agent-and-locators.mdx",
          ),
          file("agent-steps", "Agent steps", "Sparkle", "concepts/agent-steps.mdx"),
          file("replay-cache", "Replay cache", "RotateCcwClock", "concepts/replay-cache.mdx"),
          file("emulators", "Emulators", "Server", "concepts/emulators.mdx"),
          file("emulator-state", "Seeding and state", "Sprout", "concepts/emulator-state.mdx"),
          file("isolation", "Isolation", "Layers", "concepts/isolation.mdx"),
          file("flight-records", "Flight records", "FileSearch", "concepts/flight-records.mdx"),
        ],
      },
      {
        title: "Fault matrix",
        pages: [
          file("fault-matrix", "Overview", "Grid3x3", "fault-matrix/overview.mdx"),
          file("invariants", "Writing invariants", "Scale", "fault-matrix/invariants.mdx"),
          file("run-the-matrix", "Running it", "Play", "fault-matrix/run-the-matrix.mdx"),
          file("matrix-results", "Reading results", "Table", "fault-matrix/results.mdx"),
          file("matrix-planning", "Planning and budget", "ListFilter", "fault-matrix/planning.mdx"),
          file("fault-kinds", "Fault kinds", "Zap", "fault-matrix/fault-kinds.mdx"),
          file("common-findings", "Common findings", "Bug", "fault-matrix/common-findings.mdx"),
        ],
      },
      {
        title: "Real stacks",
        pages: [
          file("real-stacks", "When you need it", "Network", "real-stacks/overview.mdx"),
          file("stack-environment", "Several apps", "Boxes", "real-stacks/several-apps.mdx"),
          file("background-jobs", "Background jobs", "Workflow", "real-stacks/background-jobs.mdx"),
          file("sockets-and-streams", "WebSockets and SSE", "Radio", "real-stacks/sockets.mdx"),
          file("outside-hosts", "Outside hosts", "Globe", "real-stacks/outside-hosts.mdx"),
          file("node-preload", "The Node preload", "Cpu", "real-stacks/preload.mdx"),
          file("processes", "Processes", "Activity", "real-stacks/processes.mdx"),
          file("stack-databases", "Databases", "Database", "real-stacks/databases.mdx"),
          file(
            "stack-example",
            "A worked example",
            "BookOpenCheck",
            "real-stacks/worked-example.mdx",
          ),
        ],
      },
      {
        title: "Writing tests",
        pages: [
          file("secrets", "Secrets", "KeyRound", "writing-tests/secrets.mdx"),
          file("email-and-otp", "Email and 2FA codes", "Mail", "writing-tests/email-and-otp.mdx"),
          file("sessions", "Saved sessions", "UserCheck", "writing-tests/sessions.mdx"),
          file("two-people", "A second person", "Users", "writing-tests/two-people.mdx"),
          file("time-travel", "Time travel", "Clock", "writing-tests/time-travel.mdx"),
          file("data-faults", "Database and cache", "Database", "writing-tests/data-faults.mdx"),
          file(
            "integration-lint",
            "Integration lint",
            "ShieldCheck",
            "writing-tests/integration-lint.mdx",
          ),
          file("debugging", "Debugging a failure", "ScanSearch", "writing-tests/debugging.mdx"),
        ],
      },
      {
        title: "Platforms",
        pages: [
          file("web", "Web", "Globe", "platforms/web.mdx"),
          file("mobile", "Android setup", "Smartphone", "platforms/android-setup.mdx"),
          file("android-build", "Android builds", "Hammer", "platforms/android-build.mdx"),
          file("android-tests", "Android tests", "TabletSmartphone", "platforms/android-tests.mdx"),
          file(
            "parallel-emulators",
            "Parallel emulators",
            "Layers",
            "platforms/parallel-emulators.mdx",
          ),
          file("playwright", "Playwright Test", "FlaskConical", "platforms/playwright.mdx"),
        ],
      },
      {
        title: "Running",
        pages: [
          file("ci", "CI and GitHub", "GitPullRequest", "running/ci.mdx"),
          file("pr-comment", "Pull request comment", "MessageSquare", "running/pr-comment.mdx"),
          file("shards", "Shards and JUnit", "Split", "running/shards.mdx"),
          file("dashboard", "Dashboard", "LayoutDashboard", "running/dashboard.mdx"),
          file("recordings", "Recordings", "Video", "running/recordings.mdx"),
          file("live-runs", "Live runs and reruns", "Radio", "running/live-runs.mdx"),
          file("impact", "Changed tests", "GitCompare", "running/impact.mdx"),
          file("fidelity", "Fidelity", "Scale", "running/fidelity.mdx"),
          file(
            "fidelity-cleanup",
            "Cleaning up sandboxes",
            "Eraser",
            "running/fidelity-cleanup.mdx",
          ),
          file("configuration", "Configuration", "SlidersHorizontal", "running/configuration.mdx"),
        ],
      },
      {
        /*
         * The guides danwo hands coding agents, kept whole where a page written for the website
         * has taken their place above, so every guide still has a page.
         */
        title: "For coding agents",
        pages: [
          guide("agents-first-test", "First test guide", "Bot", "first-test"),
          guide("agents-matrix", "Matrix guide", "Bot", "matrix"),
          guide("agents-locators", "Locators guide", "Bot", "locators-vs-agent"),
          guide(
            "agents-providers",
            "Providers guide",
            "Bot",
            "providers",
            MOVED_SECTIONS.providers,
          ),
          guide("agents-debugging", "Debugging guide", "Bot", "debugging"),
          guide("agents-secrets", "Secrets guide", "Bot", "secrets"),
          guide("agents-email-and-otp", "Email and OTP guide", "Bot", "email-and-otp"),
          guide("agents-sessions", "Sessions guide", "Bot", "sessions"),
          guide("agents-time", "Time guide", "Bot", "time"),
          guide("agents-infrastructure", "Infrastructure guide", "Bot", "infrastructure"),
          guide("agents-lint", "Lint guide", "Bot", "lint"),
          sections("agents-real-stacks", "Real stacks guide", "Bot", {
            topic: "providers",
            keep: REAL_STACK_SECTIONS,
            description:
              "The coding agents' guide to running a real app under danwo: its own start command, several apps behind one proxy, background jobs, sockets and the hosts no emulator answers.",
          }),
          guide("agents-mobile", "Mobile guide", "Bot", "mobile"),
          guide("agents-playwright", "Playwright guide", "Bot", "playwright"),
          guide("agents-ci", "CI guide", "Bot", "ci"),
          guide("agents-dashboard", "Dashboard guide", "Bot", "dashboard"),
          guide("agents-fidelity", "Fidelity guide", "Bot", "fidelity"),
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
        pages: [{ slug: "index", title: "Providers", icon: "Plug", source: { kind: "providers" } }],
      },
      {
        title: "Payments",
        pages: [
          provider("stripe"),
          part("stripe-billing", "Stripe billing", "stripe.svg"),
          part("stripe-js", "Stripe.js and cards", "stripe.svg"),
          ...["paystack", "flutterwave", "bachs"].map(provider),
        ],
      },
      { title: "Email and messaging", pages: ["resend", "twilio", "slack"].map(provider) },
      {
        title: "Identity",
        pages: [
          provider("google"),
          part("google-workspace", "Gmail, Calendar, Drive", "google.svg"),
          ...["microsoft", "github", "auth0", "clerk"].map(provider),
        ],
      },
      { title: "Storage", pages: [provider("s3")] },
      {
        title: "AI",
        pages: [
          provider("model-apis"),
          part("model-scripts", "Scripting replies", "openai.svg", "openai-on-dark.svg"),
          part("model-providers", "More model APIs", "openai.svg", "openai-on-dark.svg"),
          provider("composio"),
        ],
      },
      { title: "Connectors", pages: ["nylas", "nango", "unipile"].map(provider) },
      { title: "Realtime", pages: ["pusher", "novu", "tiptap"].map(provider) },
      { title: "Infrastructure", pages: [provider("aws")] },
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
            example: {
              file: "tests/buy-credits.danwo.ts",
              from: "examples/shop/tests/buy-credits.danwo.ts",
            },
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
          reference("cache", "Cache outcomes", "RotateCcwClock", {
            topics: ["cache"],
            description: "What the replay cache did with each recorded step.",
          }),
          reference("exports", "Every export", "Package", {
            topics: ["exports"],
            description:
              "Every name `@danwo/sdk` exports, with its kind and what it is: one list to search.",
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
          ...EXAMPLES.map((example): PlannedPage => ({
            slug: example.slug,
            title: example.name,
            icon: exampleIcon(example),
            source: { kind: "example", example: example.slug },
          })),
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
