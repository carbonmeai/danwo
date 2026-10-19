/**
 * The docs' table of contents: every page, where its text comes from and where it sits in the
 * sidebar. Most pages are danwo's own guides, README sections and spec topics, so the docs say
 * what `danwo guide` and `danwo spec` say; the rest are written for the website, under `content/docs`.
 */

/** Where a page's text comes from. */
export type PageSource =
  /** A page written for the website, under `content/docs`. */
  | { readonly kind: "file"; readonly file: string }
  /** A `danwo guide`, minus the sections that have pages of their own. */
  | { readonly kind: "guide"; readonly topic: string; readonly drop?: readonly string[] }
  /** One `##` section of the README. */
  | {
      readonly kind: "readme"
      readonly heading: string
      readonly title: string
      readonly description: string
    }
  /** Topics of `danwo spec`, one after the other. */
  | {
      readonly kind: "spec"
      readonly topics: readonly string[]
      readonly title: string
      readonly description: string
    }
  /** The provider pages and their index, built from the provider list and the spec. */
  | { readonly kind: "providers" }

/** A page: its slug inside its folder and its source. */
export interface PlannedPage {
  readonly slug: string
  readonly source: PageSource
}

/** A sidebar folder of pages; the root folder has no directory. */
export interface PlannedFolder {
  readonly dir: string
  readonly title: string
  readonly icon?: string
  readonly defaultOpen?: boolean
  readonly pages: readonly PlannedPage[]
}

/** A page from a file under `content/docs`. */
function file(slug: string, path = `${slug}.mdx`): PlannedPage {
  return { slug, source: { kind: "file", file: path } }
}

/** A page from a guide. */
function guide(slug: string, topic = slug, drop?: readonly string[]): PlannedPage {
  return { slug, source: { kind: "guide", topic, ...(drop && { drop }) } }
}

/** A page from spec topics. */
function spec(slug: string, title: string, description: string, ...topics: string[]): PlannedPage {
  return { slug, source: { kind: "spec", topics, title, description } }
}

/** Sections of the providers guide that are pages under Providers instead. */
export const PROVIDER_GUIDE_SECTIONS = ["Auth0", "Clerk", "Composio"]

export const PLAN: readonly PlannedFolder[] = [
  {
    dir: "",
    title: "Get started",
    pages: [
      file("index"),
      file("why-danwo"),
      file("installation"),
      guide("quickstart", "first-test"),
    ],
  },
  {
    dir: "concepts",
    title: "Concepts",
    icon: "BookOpen",
    defaultOpen: true,
    pages: [
      guide("tests", "locators-vs-agent"),
      file("replay-cache", "concepts/replay-cache.mdx"),
      guide("emulators", "providers", PROVIDER_GUIDE_SECTIONS),
      guide("invariants-and-matrix", "matrix"),
      guide("flight-records", "debugging"),
      guide("data-faults", "infrastructure"),
      guide("integration-lint", "lint"),
      guide("time-travel", "time"),
      guide("sessions"),
      guide("secrets"),
      guide("email-and-otp"),
    ],
  },
  {
    dir: "providers",
    title: "Providers",
    icon: "Plug",
    pages: [{ slug: "index", source: { kind: "providers" } }],
  },
  {
    dir: "tools",
    title: "Platforms and tools",
    icon: "Wrench",
    pages: [
      guide("mobile"),
      guide("playwright"),
      guide("ci"),
      guide("dashboard"),
      {
        slug: "mcp",
        source: {
          kind: "readme",
          heading: "Coding agents (MCP)",
          title: "Coding agents and MCP",
          description:
            "danwo's MCP server, skill, spec and guides let Claude Code, Cursor and Codex run, explain and write danwo tests.",
        },
      },
      guide("fidelity"),
    ],
  },
  {
    dir: "reference",
    title: "Reference",
    icon: "FileCode",
    pages: [
      spec("cli", "CLI", "Every `danwo` command and its options.", "cli"),
      spec("config", "Config", "`danwo.config.ts`: `defineConfig` and every option.", "config"),
      spec(
        "test-api",
        "Test API and fixtures",
        "What a `*.danwo.ts` file declares tests with, and what test bodies receive.",
        "api",
        "fixtures",
      ),
      spec(
        "locators-and-expect",
        "Locators and expect",
        "Finding elements the way a user names them, and the assertions on them.",
        "locators",
        "expect",
      ),
      spec(
        "agent",
        "Agent",
        "`agent.act`, `assert`, `extract` and `waitFor`, and their options.",
        "agent",
      ),
      spec("secrets", "Secrets", "Configured secrets, filled by name.", "secrets"),
      spec(
        "environments",
        "Environments and services",
        "Starting the app and the emulators a worker's tests run against.",
        "environments",
      ),
      spec(
        "emulator-helpers",
        "Emulator helpers",
        "Reading what the app did at a provider, or acting as a provider's user.",
        "emulators",
      ),
      spec("faults", "Faults", "The fault vocabulary `danwo matrix` plans from.", "faults"),
      spec(
        "errors",
        "Error codes",
        "Every error code a run reports, and what to do about it.",
        "errors",
      ),
      spec(
        "cache",
        "Cache outcomes",
        "What the replay cache did with each recorded step.",
        "cache",
      ),
      spec("lint-rules", "Lint rules", "Every integration lint rule.", "lint"),
    ],
  },
]
