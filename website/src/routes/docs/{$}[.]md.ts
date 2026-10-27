import { createFileRoute } from "@tanstack/react-router"

import { markdownResponse } from "../../lib/markdown-page.ts"

/** Each docs page as markdown, for language models and the "Copy page" button. */
export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => markdownResponse(params._splat, "en"),
    },
  },
})
