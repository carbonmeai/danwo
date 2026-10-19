/**
 * Builds the docs tree before Vite reads it, and again whenever a guide, the README or a page
 * written for the website changes while the dev server runs. Also serves the landing page's
 * highlighted code samples as a virtual module.
 */
import { join } from "node:path"

import type { Plugin } from "vite"

import { codeSamples } from "./code-samples.ts"
import { GUIDES_DIR, REPO_ROOT } from "./danwo.ts"
import { CONTENT, generateDocs } from "./generate.ts"

/** Files whose change rebuilds the docs tree. */
const WATCHED = [GUIDES_DIR, CONTENT, join(REPO_ROOT, "README.md")]

/** The module the landing page imports its code samples from. */
const SAMPLES_ID = "virtual:danwo/code-samples"
const RESOLVED_SAMPLES_ID = `\0${SAMPLES_ID}`

/** The Vite plugin that keeps `generated/docs` in step with its sources. */
export function danwoDocs(): Plugin {
  return {
    name: "danwo-docs",
    enforce: "pre",
    /* Before any other plugin reads the content folder. */
    config() {
      generateDocs()
    },
    resolveId(id) {
      return id === SAMPLES_ID ? RESOLVED_SAMPLES_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_SAMPLES_ID) return undefined

      return `export default ${JSON.stringify(await codeSamples())}`
    },
    configureServer(server) {
      server.watcher.add(WATCHED)
      server.watcher.on("all", (_event, path) => {
        if (!WATCHED.some((watched) => path.startsWith(watched))) return

        const changed = generateDocs()

        if (changed > 0) server.config.logger.info(`docs: ${changed} file(s) rebuilt`)
      })
    },
  }
}
