import { fileURLToPath } from "node:url"

import { uiSourceAlias } from "@danwo/ui/source-alias"
import pandacss from "@pandacss/dev/postcss"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { DEDUPE, depsCacheDir } from "./src/vite-cache.ts"

const here = fileURLToPath(new URL(".", import.meta.url))

/**
 * The build's server takes every dependency into its bundle but the runner, which it imports from
 * the installed package, so the published dashboard depends on nothing else at run time.
 */
const SELF_CONTAINED_SERVER = {
  ssr: {
    resolve: { noExternal: true as const },
    build: { rolldownOptions: { external: [/^@danwo\/runner(\/|$)/] } },
  },
}

/**
 * The dashboard as a TanStack Start app. In danwo's repository `danwo serve` starts it with this
 * config; `bun run build` builds what the published package serves. Its dependency bundles live in
 * a folder keyed by the installed dependencies, and React is loaded once.
 */
export default defineConfig(({ command }) => ({
  root: here,
  cacheDir: depsCacheDir(here),
  css: { postcss: { plugins: [pandacss({ configPath: `${here}panda.config.ts`, cwd: here })] } },
  resolve: { alias: [uiSourceAlias], dedupe: [...DEDUPE] },
  ...(command === "build" && { environments: SELF_CONTAINED_SERVER }),
  plugins: [tanstackStart(), react()],
}))
