import { createFileRoute } from "@tanstack/react-router"

import { DocsPageView, docsPageHead, loadDocsPage } from "../../components/docs-page.tsx"

/*
 * The docs tree is bundled with the site, so the loader reads it wherever it runs: at build time
 * for the static pages, and in the browser on navigation, with no server to ask.
 */
export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => loadDocsPage(params._splat, "en"),
  head: ({ loaderData }) => docsPageHead(loaderData),
  component: Page,
})

function Page() {
  return <DocsPageView data={Route.useLoaderData()} lang="en" />
}
