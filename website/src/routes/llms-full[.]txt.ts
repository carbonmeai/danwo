import { createFileRoute } from "@tanstack/react-router"

import { guidesFull } from "../lib/agent-guides.ts"
import { docsLlms } from "../lib/source.ts"

/** Every docs page as markdown in one file, then every guide for coding agents in full. */
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(`${await docsLlms.full("en")}\n\n${guidesFull()}`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
