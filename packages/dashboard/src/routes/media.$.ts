import { createFileRoute } from "@tanstack/react-router"

import { projectRoot } from "../lib/project-files.ts"
import { serveMedia } from "../modules/record/record-media.ts"

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveMedia(projectRoot(), params._splat ?? "", request),
    },
  },
})
