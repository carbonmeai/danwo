import { createFileRoute } from "@tanstack/react-router"

import { DocsPageView, docsPageHead, loadDocsPage } from "../../../components/docs-page.tsx"

/** The docs in Simplified Chinese; a page not yet translated is shown in English. */
export const Route = createFileRoute("/zh-CN/docs/$")({
  loader: ({ params }) => loadDocsPage(params._splat, "zh-CN"),
  head: ({ loaderData }) => docsPageHead(loaderData),
  component: Page,
})

function Page() {
  return <DocsPageView data={Route.useLoaderData()} lang="zh-CN" />
}
