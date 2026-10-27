import { createFileRoute } from "@tanstack/react-router"

import { guidesIndex } from "../lib/agent-guides.ts"
import { docsLlms } from "../lib/source.ts"

/** The index of the docs for language models: every page, then every guide for coding agents. */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(`${docsLlms.index("en")}\n\n${guidesIndex()}`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
