/** The web app's build: TanStack Start on Vite, React, and Tailwind on the examples' kit. */
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), react()],
})
