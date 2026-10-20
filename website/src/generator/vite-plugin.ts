/**
 * Builds the docs tree before Vite reads it, and again whenever a guide, the README or a page
 * written for the website changes while the dev server runs. Also serves the landing page's
 * highlighted code samples as a virtual module, and copies the brand files into `public/`.
 */
import { join } from "node:path"

import type { Plugin } from "vite"

import { copyGuides } from "./agent-guides.ts"
import { BRAND_DIR, copyBrand } from "./brand.ts"
import { codeSamples } from "./code-samples.ts"
import { GUIDES_DIR, REPO_ROOT } from "./danwo.ts"
import { CONTENT, generateDocs, WEBSITE } from "./generate.ts"

/** Files whose change rebuilds the docs tree. */
const WATCHED = [GUIDES_DIR, CONTENT, join(REPO_ROOT, "README.md")]

/** Where Vite serves static files from. */
const PUBLIC = join(WEBSITE, "public")

/** The module the landing page imports its code samples from. */
const SAMPLES_ID = "virtual:danwo/code-samples"
const RESOLVED_SAMPLES_ID = `\0${SAMPLES_ID}`

/** Copies the brand files or the raw guides into `public/` again when `path` is one of them. */
function copyChanged(path: string): void {
  if (path.startsWith(BRAND_DIR)) copyBrand(PUBLIC)
  if (path.startsWith(GUIDES_DIR)) copyGuides(PUBLIC)
}

/** The Vite plugin that keeps `generated/docs` in step with its sources. */
export function danwoDocs(): Plugin {
  return {
    name: "danwo-docs",
    enforce: "pre",
    /* Before any other plugin reads the content folder. */
    config() {
      generateDocs()
      copyBrand(PUBLIC)
      copyGuides(PUBLIC)
    },
    resolveId(id) {
      return id === SAMPLES_ID ? RESOLVED_SAMPLES_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_SAMPLES_ID) return undefined

      return `export default ${JSON.stringify(await codeSamples())}`
    },
    configureServer(server) {
      server.watcher.add([...WATCHED, BRAND_DIR])
      server.watcher.on("all", (_event, path) => {
        copyChanged(path)
        if (!WATCHED.some((watched) => path.startsWith(watched))) return

        const changed = generateDocs()

        if (changed > 0) server.config.logger.info(`docs: ${changed} file(s) rebuilt`)
      })
    },
  }
}
