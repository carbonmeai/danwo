import { createFileRoute, notFound } from "@tanstack/react-router"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page"
import { Suspense, use } from "react"

import { useMdxComponents } from "../../components/mdx.tsx"
import { baseOptions } from "../../lib/layout.tsx"
import { pageHead } from "../../lib/meta.ts"
import { markdownPath } from "../../lib/paths.ts"
import { SITE } from "../../lib/site.ts"
import { docs, source } from "../../lib/source.ts"

/*
 * The docs tree is bundled with the site, so the loader reads it wherever it runs: at build time
 * for the static pages, and in the browser on navigation, with no server to ask.
 */
export const Route = createFileRoute("/docs/$")({
  loader: async ({ params }) => {
    const slugs = (params._splat ?? "").split("/").filter(Boolean)
    const page = source.getPage(slugs)

    if (!page) throw notFound()

    await docs.getPage(page.path)?.preload()

    return {
      path: page.path,
      url: page.url,
      title: page.data.title,
      description: page.data.description ?? "",
      markdownUrl: markdownPath(slugs.join("/")),
      origin: page.data.source,
    }
  },
  head: ({ loaderData }) =>
    loaderData
      ? pageHead({
          title: loaderData.title,
          description: loaderData.description,
          path: loaderData.url,
          type: "article",
        })
      : {},
  component: Page,
})

/** Where the page's text lives in the repository, when the repository is public. */
function editUrl(origin: string | undefined): string | undefined {
  if (SITE.repo === undefined || origin === undefined) return undefined

  return `https://github.com/${SITE.repo}/blob/${SITE.branch}/${origin}`
}

function Content({
  path,
  markdownUrl,
  origin,
}: {
  readonly path: string
  readonly markdownUrl: string
  readonly origin: string | undefined
}) {
  const page = docs.getPage(path)

  if (!page) throw new Error(`no docs page at ${path}`)

  const { toc } = use(page.load())
  const Mdx = page.body
  const github = editUrl(origin)

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="-mt-4 flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} {...(github && { githubUrl: github })} />
      </div>
      <DocsBody>
        <Mdx components={useMdxComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

function Page() {
  const { path, markdownUrl, origin } = Route.useLoaderData()

  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
      <Suspense>
        <Content path={path} markdownUrl={markdownUrl} origin={origin} />
      </Suspense>
    </DocsLayout>
  )
}
