/**
 * The digest UI: a React app built with `vite build web` and served with `vite preview web`,
 * which passes `/api` on to the API at `API_URL`.
 */
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  preview: {
    proxy: { "/api": { target: process.env.API_URL ?? "http://127.0.0.1:4500" } },
  },
})
