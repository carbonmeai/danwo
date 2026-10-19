import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { resolveIcon } from "../src/lib/icons.tsx"
import { pageHead } from "../src/lib/meta.ts"
import { formatDate, newestFirst, postSlug } from "../src/lib/posts.ts"
import { licenceWords, repoUrl, SITE } from "../src/lib/site.ts"

/** The markup a sidebar entry's icon renders for `icon`. */
function iconFor(icon: string | undefined): string {
  return renderToStaticMarkup(resolveIcon(icon))
}

describe("sidebar icons", () => {
  it("shows an image for a path, and one per theme for two", () => {
    const one = iconFor("/icons/stripe.svg")
    const pair = iconFor("/icons/github.svg|/icons/github-on-dark.svg")

    expect(one).toContain('<img src="/icons/stripe.svg" alt="" width="16" height="16"/>')
    expect(pair).toContain(
      '<img src="/icons/github.svg" alt="" width="16" height="16" class="only-light"/>',
    )
    expect(pair).toContain(
      '<img src="/icons/github-on-dark.svg" alt="" width="16" height="16" class="only-dark"/>',
    )
  })

  it("names a Lucide icon, and shows nothing for an unknown name or none", () => {
    expect(iconFor("BookOpen")).toContain("<svg")
    expect(iconFor("NoSuchIcon")).toBe("")
    expect(iconFor(undefined)).toBe("")
  })
})

describe("posts", () => {
  const posts = [
    { info: { path: "older.mdx" }, date: new Date("2026-01-02") },
    { info: { path: "newer.md" }, date: new Date("2026-10-19") },
  ]

  it("are named by their file and listed newest first", () => {
    expect(newestFirst(posts).map(postSlug)).toEqual(["newer", "older"])
  })

  it("print their date the site's way", () => {
    expect(formatDate(new Date("2026-10-19T00:00:00Z"))).toBe("19 October 2026")
  })
})

describe("page heads", () => {
  it("give every page its canonical address and social card", () => {
    const head = pageHead({ title: "Quickstart", description: "Start.", path: "/docs/quickstart" })

    expect(head.links).toEqual([{ rel: "canonical", href: `${SITE.url}/docs/quickstart` }])
    expect(head.meta).toContainEqual({ title: "Quickstart · danwo" })
    expect(head.meta).toContainEqual({ property: "og:image", content: `${SITE.url}/og.png` })
  })
})

describe("site facts", () => {
  it("say open source only once the licence does, and link a repository only once there is one", () => {
    expect(licenceWords()).toBe(SITE.licence.openSource ? "Open source" : SITE.licence.wording)
    expect(repoUrl()).toBe(SITE.repo === undefined ? undefined : `https://github.com/${SITE.repo}`)
  })
})
