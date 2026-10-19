import { createFileRoute } from "@tanstack/react-router"

import { docsLlms } from "../lib/source.ts"

/** The index of the docs for language models: every page with its description and address. */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(docsLlms.index(), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
