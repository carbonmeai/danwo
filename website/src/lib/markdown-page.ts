/** A docs page as markdown, in a language: what `/docs/<page>.md` and its Chinese twin serve. */
import { notFound } from "@tanstack/react-router"

import type { Lang } from "./i18n.ts"
import { slugsOfMarkdown } from "./paths.ts"
import { docsLlms, source } from "./source.ts"

/** The markdown of the page whose markdown address ends in `splat`, in `lang`. */
export async function markdownResponse(splat: string | undefined, lang: Lang): Promise<Response> {
  const page = source.getPage(slugsOfMarkdown((splat ?? "").split("/")), lang)

  if (!page) throw notFound()

  return new Response(await docsLlms.page(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  })
}
