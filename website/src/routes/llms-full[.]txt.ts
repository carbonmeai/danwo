import { createFileRoute } from "@tanstack/react-router"

import { docsLlms } from "../lib/source.ts"

/** Every docs page as markdown in one file, for language models. */
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await docsLlms.full(), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
