/**
 * The spec's sections about the public API, read from the sources of `@danwo/sdk` and the
 * packages it re-exports: what each export is, its doc comment and, for an interface, its members.
 */
import { createRequire } from "node:module"
import { sep } from "node:path"

import type { SpecEntry, SpecSection, SpecTopic } from "./model.ts"
import { type Declared, SourceIndex } from "./source.ts"

const require = createRequire(import.meta.url)

/** The entry modules the spec reads: what test files import, and what it re-exports. */
export const SOURCES = {
  sdk: require.resolve("@danwo/sdk"),
  runner: require.resolve("@danwo/runner/runner"),
  emulators: require.resolve("@danwo/emulators"),
} as const

type Source = keyof typeof SOURCES

/** Seed shapes of the emulators that environments seed, by the type each provider's seed takes. */
const SEED_CONFIGS = [
  "StripeSeedConfig",
  "ResendSeedConfig",
  "S3SeedConfig",
  "GoogleSeedConfig",
  "MicrosoftSeedConfig",
  "SlackSeedConfig",
  "GithubSeedConfig",
]

/** The options of a provider's service and environment, e.g. `StripeOptions`. */
const PROVIDER_OPTIONS = /^(Stripe|S3|Aws|Google|Microsoft|Slack|Github)Options$/

/** An entry from what the source declares. */
function entryOf(declared: Declared): SpecEntry {
  const inherits = declared.extends.length > 0 ? `extends ${declared.extends.join(", ")}` : ""

  return {
    name: declared.name,
    kind: declared.kind,
    signature: declared.kind === "interface" ? inherits : declared.signature,
    doc: declared.doc,
    members: declared.members.map(({ name, signature, doc }) => ({ name, signature, doc })),
  }
}

interface Fixed {
  readonly topic: SpecTopic
  readonly title: string
  readonly about: string
  readonly names: readonly (readonly [Source, string])[]
}

/** Sections that describe a fixed set of declarations. */
const FIXED: readonly Fixed[] = [
  {
    topic: "api",
    title: "Test API",
    about:
      "What a `*.danwo.ts` file declares tests with, imported from `@danwo/sdk`. `test(...)` returns a TestCase whose `.invariant(fn)` must hold however the body went; `danwo matrix` judges faulted runs by it.",
    names: [
      ["sdk", "test"],
      ["runner", "TestAPI"],
      ["runner", "TestCase"],
      ["runner", "TestOptions"],
      ["runner", "UseOptions"],
      ["runner", "SessionDefinition"],
      ["runner", "SessionSetup"],
      ["runner", "FixtureSetup"],
      ["runner", "FixtureDefinitions"],
      ["sdk", "unique"],
    ],
  },
  {
    topic: "locators",
    title: "Screen and locators",
    about:
      "`screen.getBy…` finds elements the way a user names them; actions need exactly one match. Prefer getByRole with a name, then getByLabel, getByText, getByTestId.",
    names: [
      ["runner", "Screen"],
      ["runner", "Locator"],
      ["runner", "App"],
      ["runner", "SessionMail"],
    ],
  },
  {
    topic: "expect",
    title: "Assertions",
    about:
      "`expect(locator)` and `expect(screen)` retry until their timeout; `expect(value)` is a plain value check.",
    names: [
      ["runner", "Expect"],
      ["runner", "LocatorAssertions"],
      ["runner", "PageAssertions"],
      ["runner", "VisualOptions"],
    ],
  },
  {
    topic: "agent",
    title: "Agent",
    about:
      "Plain-language steps (`act`), claims (`assert`), typed reads (`extract`) and waits (`waitFor`). A verified step is recorded and replays with no model call.",
    names: [
      ["runner", "Agent"],
      ["runner", "ActOptions"],
      ["runner", "ActResult"],
      ["runner", "AssertOptions"],
      ["runner", "ExtractOptions"],
      ["runner", "WaitForOptions"],
      ["runner", "PollOption"],
      ["runner", "Budget"],
    ],
  },
  {
    topic: "secrets",
    title: "Secrets",
    about:
      "Secrets are configured by name; tests and the agent pass `secret(name)` and never see the value, and records never hold it. A secret only goes into a field its purpose allows.",
    names: [
      ["runner", "SessionSecret"],
      ["runner", "SecretPurpose"],
      ["runner", "FieldKind"],
      ["runner", "Secret"],
      ["sdk", "totp"],
    ],
  },
  {
    topic: "config",
    title: "Config",
    about: "`danwo.config.ts` default-exports `defineConfig({...})`; every key is optional.",
    names: [
      ["sdk", "defineConfig"],
      ["runner", "DanwoConfig"],
      ["runner", "Budgets"],
      ["runner", "RelocationPolicy"],
      ["runner", "ReadinessMode"],
    ],
  },
]

/** Whether a declaration lives in the emulators package or the mail sources. */
function isHelper(declared: Declared): boolean {
  return (
    declared.kind === "function" &&
    [`${sep}emulators${sep}`, `${sep}mail${sep}`].some((part) => declared.file.includes(part))
  )
}

/** Builds the API sections from the sources, reading each module once. */
export function apiSections(index = new SourceIndex()): SpecSection[] {
  const describe = (source: Source, name: string) => index.describe(SOURCES[source], name)
  const sdk = index.names(SOURCES.sdk).map((name) => describe("sdk", name))
  const fixed = FIXED.map((section) => ({
    topic: section.topic,
    title: section.title,
    about: section.about,
    entries: section.names.map(([source, name]) => entryOf(describe(source, name))),
  }))
  const environments = sdk.filter(
    (d) =>
      /^[a-z0-9]+(Environment|Service)$/i.test(d.name) ||
      /^[a-z]+(Snapshot|WorkerDatabase|WorkerFile)$/.test(d.name) ||
      PROVIDER_OPTIONS.test(d.name) ||
      [
        "startServices",
        "Services",
        "UnroutedHosts",
        "Seed",
        "EnvironmentContext",
        "MINISTACK_IMAGE",
      ].includes(d.name),
  )
  const seeds = SEED_CONFIGS.map((name) => describe("emulators", name))

  return [
    ...fixed.slice(0, 1),
    {
      topic: "fixtures",
      title: "Fixtures",
      about:
        "What test bodies, hooks and invariants receive. Environments add their own (`stripe`, `proxy`, `settle`…); type them with `test.extend<StripeFixtures>()`.",
      entries: [
        ...sdk.filter((d) => /Fixtures?$/.test(d.name)),
        describe("runner", "SessionFixtures"),
        describe("sdk", "Users"),
        describe("sdk", "UserSession"),
      ].map(entryOf),
    },
    ...fixed.slice(1),
    {
      topic: "environments",
      title: "Environments and services",
      about:
        "A config's `environment()` starts what a worker's tests run against: the app plus provider emulators behind danwo's egress proxy. Each provider's `seed` takes the shape listed under its SeedConfig.",
      entries: [...environments, ...seeds].map(entryOf),
    },
    {
      topic: "emulators",
      title: "Emulator helpers",
      about:
        "Read what the app did at a provider, or act as a provider's user, from a test or an invariant.",
      entries: sdk.filter(isHelper).map(entryOf),
    },
  ]
}

/** One line per export of `@danwo/sdk`: everything a test file can import. */
export function exportsSection(index = new SourceIndex()): SpecSection {
  return {
    topic: "exports",
    title: "Every export of @danwo/sdk",
    about: "Each name a test file or config can import, with its kind and what it is.",
    entries: index.names(SOURCES.sdk).map((name) => {
      const declared = index.describe(SOURCES.sdk, name)

      return {
        name,
        kind: declared.kind,
        signature: declared.kind === "function" ? declared.signature : "",
        doc: declared.doc.split("\n\n")[0] ?? "",
        members: [],
      }
    }),
  }
}
