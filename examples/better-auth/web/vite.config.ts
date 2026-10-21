/**
 * The web app's build. In development `npm run dev` serves it on port 5173 and hands `/api` to
 * the API on port 3000 (`npm run dev:api`), so the browser sees one origin, as it does once the
 * API serves the build itself.
 */
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
})
