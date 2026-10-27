/** What the docs, blog and 404 layouts share: the brand and the top links. */
import type { DocsLayoutProps } from "fumadocs-ui/layouts/notebook"
import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared"

import { Lockup } from "../components/brand.tsx"
import { NpmIcon } from "../landing/glyphs.tsx"
import type { Lang } from "./i18n.ts"
import { npmUrl, repoUrl } from "./site.ts"

/** The package on npm, as an icon beside GitHub's in the top bar. */
const NPM_LINK: LinkItemType = {
  type: "icon",
  icon: <NpmIcon />,
  text: "npm",
  label: "@danwo/cli on npm",
  url: npmUrl(),
  external: true,
}

export function baseOptions(): BaseLayoutProps {
  const github = repoUrl()

  return {
    nav: { title: <Lockup height={22} />, url: "/" },
    links: [
      { text: "Docs", url: "/docs", active: "nested-url" },
      { text: "Blog", url: "/blog", active: "nested-url" },
      { text: "Changelog", url: "/changelog" },
      NPM_LINK,
    ],
    ...(github && { githubUrl: github }),
  }
}

/**
 * The docs' frame: the brand, search, links and the language switch in a bar across the top, the
 * tabs (Documentation, Providers, Reference, Examples) under it, and each tab's own sidebar of
 * sections. The blog and changelog are in English, so only their link text is translated.
 */
export function docsOptions(lang: Lang = "en"): Omit<DocsLayoutProps, "tree"> {
  const github = repoUrl()
  const zh = lang === "zh-CN"

  return {
    nav: { title: <Lockup height={22} />, url: "/", mode: "top" },
    tabMode: "navbar",
    i18n: true,
    links: [
      { text: zh ? "博客" : "Blog", url: "/blog", active: "nested-url" },
      { text: zh ? "更新日志" : "Changelog", url: "/changelog" },
      NPM_LINK,
    ],
    ...(github && { githubUrl: github }),
  }
}
