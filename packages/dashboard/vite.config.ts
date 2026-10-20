import { fileURLToPath } from "node:url"

import { uiSourceAlias } from "@danwo/ui/source-alias"
import pandacss from "@pandacss/dev/postcss"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { DEDUPE, depsCacheDir } from "./src/vite-cache.ts"

const here = fileURLToPath(new URL(".", import.meta.url))

/**
 * The dashboard as a TanStack Start app; `danwo serve` starts it with this config. Its dependency
 * bundles live in a folder keyed by the installed dependencies, and React is loaded once.
 */
export default defineConfig({
  root: here,
  cacheDir: depsCacheDir(here),
  css: { postcss: { plugins: [pandacss({ configPath: `${here}panda.config.ts`, cwd: here })] } },
  resolve: { alias: [uiSourceAlias], dedupe: [...DEDUPE] },
  plugins: [tanstackStart(), react()],
})
