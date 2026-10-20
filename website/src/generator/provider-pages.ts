/**
 * The Providers section of the docs: an index of every emulated provider, and a page per
 * provider that gathers what the spec and the guides say about it.
 */
import { type Provider, PROVIDERS } from "../lib/providers.ts"
import { readGuide, type SpecEntry, type SpecSection } from "./danwo.ts"
import { frontmatter, guidePage, referenceEntry, section } from "./markdown.ts"

/** The spec entries of `topic` that belong to `provider`, by their names' prefixes. */
function entriesOf(
  provider: Provider,
  spec: ReadonlyMap<string, SpecSection>,
  topic: string,
): SpecEntry[] {
  const entries = spec.get(topic)?.entries ?? []

  return entries.filter((entry) =>
    provider.prefixes.some((prefix) => entry.name.toLowerCase().startsWith(prefix)),
  )
}

/** What the guides say about `provider`: its own section of the providers guide, or its guide. */
function guideText(provider: Provider): string | undefined {
  if (provider.guideSection) return section(readGuide("providers"), provider.guideSection)
  if (provider.guide) return guidePage(readGuide(provider.guide)).body

  return undefined
}

/** A `## heading` and the entries under it, or nothing when there are none. */
function entriesBlock(heading: string, entries: readonly SpecEntry[]): string[] {
  return entries.length === 0
    ? []
    : [`## ${heading}`, ...entries.map((entry) => referenceEntry(entry, 3))]
}

/** How the emulator is checked against the real API, for providers with a fidelity suite. */
function fidelityBlock(provider: Provider): string[] {
  if (!provider.fidelity) return []

  const suites = provider.fidelity.join(" ")

  return [
    "## Checked against the real API",
    [
      `\`danwo fidelity ${suites}\` compares this emulator's answers with the provider's own by structure; see [Fidelity](/docs/fidelity).`,
      provider.fidelityNote,
    ]
      .filter(Boolean)
      .join(" "),
  ]
}

/** One provider's page, under the sidebar section named `group`. */
export function providerPage(
  provider: Provider,
  spec: ReadonlyMap<string, SpecSection>,
  group: string,
): string {
  const guide = guideText(provider)
  const parts = [
    frontmatter({
      title: provider.name,
      description: provider.summary,
      icon: [provider.icon, provider.iconDark]
        .filter((file) => file !== undefined)
        .map((file) => `/icons/${file}`)
        .join("|"),
      section: group,
      source:
        provider.guideSection || provider.guide
          ? "packages/skill/guides"
          : "packages/emulators/src",
    }),
    ...(guide ? [guide] : []),
    ...entriesBlock("Environment and seed", entriesOf(provider, spec, "environments")),
    ...entriesBlock("Test helpers", entriesOf(provider, spec, "emulators")),
    ...fidelityBlock(provider),
  ]

  return `${parts.join("\n\n")}\n`
}

/** One logo image as JSX, shown only in `theme` when one is given. */
function img(file: string, theme?: string): string {
  return `<img src="/icons/${file}" alt="" width={20} height={20}${theme ? ` className="only-${theme}"` : ""} />`
}

/** A provider's logo as JSX for a card: one image, or one per theme. */
function cardIcon(provider: Provider): string {
  return provider.iconDark
    ? `<>${img(provider.icon, "light")}${img(provider.iconDark, "dark")}</>`
    : img(provider.icon)
}

/** A kind of provider on the overview, and the providers of that kind by slug. */
export interface ProviderGroup {
  readonly title: string
  readonly slugs: readonly string[]
}

/** One provider's card on the overview. */
function card(provider: Provider): string {
  return `  <Card title=${JSON.stringify(provider.name)} href="/docs/providers/${provider.slug}" icon={${cardIcon(provider)}}>\n    ${provider.summary}\n  </Card>`
}

/**
 * The Providers overview, under the sidebar section named `group`: a heading per kind of
 * provider, the way the sidebar groups them, with a card per provider under it.
 */
export function providerIndex(group: string, kinds: readonly ProviderGroup[]): string {
  const sections = kinds.map((kind) => {
    const cards = kind.slugs.flatMap((slug) => {
      const found = PROVIDERS.find((provider) => provider.slug === slug)

      return found ? [card(found)] : []
    })

    return `## ${kind.title}\n\n<Cards>\n${cards.join("\n")}\n</Cards>`
  })

  return [
    frontmatter({
      title: "Providers",
      description:
        "The third-party APIs danwo emulates behind its egress proxy: the app keeps calling the real hostnames, unchanged.",
      icon: "Plug",
      section: group,
      source: "website/src/lib/providers.ts",
    }),
    "Each emulator answers the provider's real hostnames, keeps state across calls, signs its webhooks and returns the error shapes the provider's SDK parses. [Emulators](/docs/emulators) covers how an environment starts them.",
    ...sections,
    "",
  ].join("\n\n")
}
