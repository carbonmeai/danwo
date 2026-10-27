/**
 * The site's content: the docs tree `generated/docs` (built from danwo's guides, README and spec,
 * plus the pages under `content/docs`), the blog and the changelog.
 */
import { llms, loader } from "fumadocs-core/source"
import { pageSchema } from "fumadocs-core/source/schema"
import { defineCollections, defineDocs } from "fumadocs-mdx/macro"
import { z } from "zod"

import { i18n } from "./i18n.ts"
import { iconsPlugin } from "./icons.tsx"

/**
 * A docs page's frontmatter: the standard fields, the sidebar section it sits in (shown over its
 * title) and the file its text came from.
 */
const docsPageSchema = pageSchema.extend({
  section: z.string().optional(),
  source: z.string().optional(),
})

export const docs = defineDocs({
  dir: "generated/docs",
  docs: {
    async: true,
    schema: docsPageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
})

/**
 * The docs in each language: English at `/docs`, Chinese at `/zh-CN/docs`, where a page not yet
 * translated falls back to its English one.
 */
export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/docs",
  i18n,
  plugins: [iconsPlugin()],
})

/** The docs as plain text for language models: `/llms.txt`, `/llms-full.txt` and each `.md`. */
export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${page.data.description ?? ""}

${await page.data.getText("processed")}`,
})

/** A blog post's or changelog entry's frontmatter. */
const postSchema = pageSchema.extend({
  date: z.coerce.date(),
  author: z.string().optional(),
})

export const blog = defineCollections({
  type: "doc",
  dir: "content/blog",
  schema: postSchema,
})

export const changelog = defineCollections({
  type: "doc",
  dir: "content/changelog",
  schema: postSchema,
})
