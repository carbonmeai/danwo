import { createFileRoute } from "@tanstack/react-router"
import { createFromSource } from "fumadocs-core/search/server"

import { source } from "../../lib/source.ts"

/**
 * English pages are indexed with English stemming, Chinese ones with the multilingual tokenizer,
 * which splits Chinese text; each language's search finds its own pages.
 */
const search = createFromSource(source, { localeMap: { en: "english" } })

/** The docs' search index, exported whole at build time; the search dialog queries it in the browser. */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async () => search.staticGET(),
    },
  },
})
