import { fileURLToPath } from "node:url"

import { uiSourceAlias } from "@danwo/ui/source-alias"
import pandacss from "@pandacss/dev/postcss"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const here = fileURLToPath(new URL(".", import.meta.url))

/** The dashboard as a TanStack Start app; `danwo serve` starts it with this config. */
export default defineConfig({
  root: here,
  css: { postcss: { plugins: [pandacss({ configPath: `${here}panda.config.ts`, cwd: here })] } },
  resolve: { alias: [uiSourceAlias] },
  plugins: [tanstackStart(), react()],
})
