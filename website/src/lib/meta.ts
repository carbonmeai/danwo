/** The `<head>` of a page: its title, description, canonical address and social cards. */
import { SITE } from "./site.ts"

/** What a page says about itself. */
export interface PageMeta {
  readonly title: string
  readonly description: string
  /** The page's path, such as `/docs/quickstart`. */
  readonly path: string
  /** An Open Graph image's path; the site's card by default. */
  readonly image?: string
  readonly type?: "website" | "article"
}

/** A route's `head()` for `page`. */
export function pageHead(page: PageMeta) {
  const url = new URL(page.path, SITE.url).href
  const image = new URL(page.image ?? "/og.png", SITE.url).href
  const title = page.path === "/" ? page.title : `${page.title} · ${SITE.name}`

  return {
    meta: [
      { title },
      { name: "description", content: page.description },
      { property: "og:type", content: page.type ?? "website" },
      { property: "og:site_name", content: SITE.name },
      { property: "og:title", content: title },
      { property: "og:description", content: page.description },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: page.description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  }
}
