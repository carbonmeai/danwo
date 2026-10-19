import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { defineConfig } from "vite"

import { prerenderedPaths } from "./src/generator/routes.ts"
import { danwoDocs } from "./src/generator/vite-plugin.ts"

/** The website as a TanStack Start app, prerendered to static HTML. */
export default defineConfig({
  server: { port: 3020 },
  preview: { port: 3021 },
  plugins: [
    danwoDocs(),
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages: prerenderedPaths().map((path) => ({ path })),
    }),
    react(),
  ],
})
