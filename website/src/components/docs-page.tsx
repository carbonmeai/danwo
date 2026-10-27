/**
 * A docs page in a language: what its route loads, its head, and the page itself. English pages
 * are at `/docs/...` and Chinese ones at `/zh-CN/docs/...`; a page with no Chinese version yet is
 * shown in English under the Chinese docs, with a line that says so.
 */
import { notFound } from "@tanstack/react-router"
import { Callout } from "fumadocs-ui/components/callout"
import { DocsLayout } from "fumadocs-ui/layouts/notebook"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/notebook/page"
import { Suspense, use } from "react"

import { zhSection } from "../generator/zh.ts"
import { type Lang, UNTRANSLATED } from "../lib/i18n.ts"
import { docsOptions } from "../lib/layout.tsx"
import { pageHead } from "../lib/meta.ts"
import { markdownPath } from "../lib/paths.ts"
import { SITE } from "../lib/site.ts"
import { docs, source } from "../lib/source.ts"
import { DocsCta } from "./docs-cta.tsx"
import { useMdxComponents } from "./mdx.tsx"

/** What a docs route loads for the page at its address. */
export interface DocsPageData {
  readonly path: string
  readonly url: string
  readonly title: string
  readonly description: string
  readonly section: string | undefined
  readonly markdownUrl: string
  readonly origin: string | undefined
  /** Whether the page is in the language asked for, rather than English in its place. */
  readonly translated: boolean
}

/** Whether `path`, a page's file, is the page in `lang`. */
function isIn(path: string, lang: Lang): boolean {
  return lang === "en" || path.includes(`.${lang}.`)
}

/** Loads the docs page at `splat` in `lang`; not found when there is none in any language. */
export async function loadDocsPage(splat: string | undefined, lang: Lang): Promise<DocsPageData> {
  const slugs = (splat ?? "").split("/").filter(Boolean)
  const page = source.getPage(slugs, lang)

  if (!page) throw notFound()

  await docs.getPage(page.path)?.preload()

  return {
    path: page.path,
    url: page.url,
    title: page.data.title,
    description: page.data.description ?? "",
    /* A page shown in English under the Chinese docs still sits in a Chinese section. */
    section:
      lang === "zh-CN" && page.data.section ? zhSection(page.data.section) : page.data.section,
    markdownUrl: markdownPath(slugs.join("/"), lang),
    origin: page.data.source,
    translated: isIn(page.path, lang),
  }
}

/** The head of a docs page. */
export function docsPageHead(data: DocsPageData | undefined) {
  return data
    ? pageHead({
        title: data.title,
        description: data.description,
        path: data.url,
        type: "article",
      })
    : {}
}

/** Where the page's text lives in the repository, when the repository is public. */
function editUrl(origin: string | undefined): string | undefined {
  if (SITE.repo === undefined || origin === undefined) return undefined

  return `https://github.com/${SITE.repo}/blob/${SITE.branch}/${origin}`
}

/** The page's actions beside its title: copy it as markdown, or open it elsewhere. */
function PageActions({
  markdownUrl,
  origin,
}: {
  readonly markdownUrl: string
  readonly origin: string | undefined
}) {
  const github = editUrl(origin)

  return (
    <div className="danwo-page-actions">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <ViewOptionsPopover markdownUrl={markdownUrl} {...(github && { githubUrl: github })} />
    </div>
  )
}

function Content({ data, lang }: { readonly data: DocsPageData; readonly lang: Lang }) {
  const page = docs.getPage(data.path)

  if (!page) throw new Error(`no docs page at ${data.path}`)

  const { toc } = use(page.load())
  const Mdx = page.body
  const untranslated = data.translated ? undefined : UNTRANSLATED[lang]

  return (
    <DocsPage
      toc={toc}
      breadcrumb={{ enabled: false }}
      tableOfContent={{ style: "clerk", footer: <DocsCta lang={lang} /> }}
    >
      {data.section && <p className="danwo-eyebrow">{data.section}</p>}
      <div className="danwo-title-row">
        <DocsTitle>{page.title}</DocsTitle>
        <PageActions markdownUrl={data.markdownUrl} origin={data.origin} />
      </div>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        {untranslated && <Callout type="info">{untranslated}</Callout>}
        <Mdx components={useMdxComponents(undefined, lang)} />
      </DocsBody>
    </DocsPage>
  )
}

/** A docs page in `lang`, in the docs' layout with that language's sidebar. */
export function DocsPageView({ data, lang }: { readonly data: DocsPageData; readonly lang: Lang }) {
  return (
    <DocsLayout {...docsOptions(lang)} tree={source.getPageTree(lang)}>
      <Suspense>
        <Content data={data} lang={lang} />
      </Suspense>
    </DocsLayout>
  )
}
