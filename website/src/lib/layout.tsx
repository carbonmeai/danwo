/** What the docs, blog and 404 layouts share: the brand and the top links. */
import type { DocsLayoutProps } from "fumadocs-ui/layouts/notebook"
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"

import { Brand } from "../components/brand.tsx"
import { repoUrl } from "./site.ts"

export function baseOptions(): BaseLayoutProps {
  const github = repoUrl()

  return {
    nav: { title: <Brand />, url: "/" },
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
      { text: "Blog", url: "/blog", active: "nested-url" },
      { text: "Changelog", url: "/changelog" },
    ],
    ...(github && { githubUrl: github }),
  }
}

/**
 * The docs' frame: the brand, search and links in a bar across the top, the tabs (Documentation,
 * Providers, Reference, Examples) under it, and each tab's own sidebar of sections.
 */
export function docsOptions(): Omit<DocsLayoutProps, "tree"> {
  const github = repoUrl()

  return {
    nav: { title: <Brand />, url: "/", mode: "top" },
    tabMode: "navbar",
    links: [
      { text: "Blog", url: "/blog", active: "nested-url" },
      { text: "Changelog", url: "/changelog" },
    ],
    ...(github && { githubUrl: github }),
  }
}
