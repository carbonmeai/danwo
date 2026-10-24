/**
 * The Vue app, built with `vite build web` into `web/dist`, which the Go server serves beside its
 * API on one origin. While you work on the page, `vite web` serves it with hot reload and passes
 * the API's paths on to the Go server at `API_URL`.
 */
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

const api = process.env.API_URL ?? "http://127.0.0.1:8080"

export default defineConfig({
  plugins: [vue()],
  server: { proxy: { "/api": api } },
})
