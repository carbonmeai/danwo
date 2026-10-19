import { createFileRoute } from "@tanstack/react-router"

import { NotFound } from "../components/not-found.tsx"
import { SITE } from "../lib/site.ts"

/** The not-found page as a file of its own, `404.html`, which static hosts serve for unknown addresses. */
export const Route = createFileRoute("/404")({
  head: () => ({
    meta: [{ title: `Not found · ${SITE.name}` }, { name: "robots", content: "noindex" }],
  }),
  component: NotFound,
})
