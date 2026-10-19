import { createFileRoute, notFound } from "@tanstack/react-router"

import { slugsOfMarkdown } from "../../lib/paths.ts"
import { docsLlms, source } from "../../lib/source.ts"

/** Each docs page as markdown, for language models and the "Copy page" button. */
export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const page = source.getPage(slugsOfMarkdown((params._splat ?? "").split("/")))

        if (!page) throw notFound()

        return new Response(await docsLlms.page(page), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        })
      },
    },
  },
})
