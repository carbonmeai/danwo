/**
 * Fern Studio's site: SvelteKit, built with `vite build` and served by adapter-node with
 * `node server.ts`, adapter-node's handler on plain HTTP. Its pages call the studio's API at `API_URL` from the server, and at
 * `PUBLIC_API_URL` from the browser.
 */
import adapter from "@sveltejs/adapter-node"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: { runes: true },
      adapter: adapter(),
    }),
  ],
})
