/** What the docs, blog and 404 layouts share: the brand and the top links. */
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
