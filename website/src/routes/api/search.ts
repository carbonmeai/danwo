import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"

import { source } from "../../lib/source.ts"

const search = createFromSource(source, { language: "english" })

/** The docs' search index, exported whole at build time; the search dialog queries it in the browser. */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async () => search.staticGET(),
    },
  },
})
