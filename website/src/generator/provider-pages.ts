/**
 * The Providers tab: every provider's page is written for the website, under
 * `content/docs/providers`; the overview's grid of provider cards is built here from the
 * provider list, grouped the way the sidebar groups them.
 */
import { type Provider, PROVIDERS } from "../lib/providers.ts"

/** Where the overview puts the grid of provider cards. */
const PROVIDER_CARDS = "{/* provider cards */}"

/** A provider's logo path for the sidebar and its heading: one image, or `light|dark`. */
export function providerIcon(provider: Provider): string {
  return [provider.icon, provider.iconDark]
    .filter((file) => file !== undefined)
    .map((file) => `/icons/${file}`)
    .join("|")
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

/** The overview's grid: a `###` heading per kind of provider with a card per provider under it. */
function providerCards(kinds: readonly ProviderGroup[]): string {
  return kinds
    .map((kind) => {
      const cards = kind.slugs.flatMap((slug) => {
        const found = PROVIDERS.find((provider) => provider.slug === slug)

        return found ? [card(found)] : []
      })

      return `### ${kind.title}\n\n<Cards>\n${cards.join("\n")}\n</Cards>`
    })
    .join("\n\n")
}

/** `text` with the overview's card grid in place of its marker; it must have the marker. */
export function withProviderCards(text: string, kinds: readonly ProviderGroup[]): string {
  if (!text.includes(PROVIDER_CARDS))
    throw new Error(`the Providers overview has no ${PROVIDER_CARDS} marker for its cards`)

  return text.replace(PROVIDER_CARDS, providerCards(kinds))
}
