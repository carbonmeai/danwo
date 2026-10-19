import { createFileRoute } from "@tanstack/react-router"

import { SITE } from "../lib/site.ts"

/** `robots.txt`: everything may be crawled; the sitemap lists it. */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", SITE.url).href}\n`,
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        ),
    },
  },
})
