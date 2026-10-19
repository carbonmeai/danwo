import { createFileRoute } from "@tanstack/react-router"

import { projectRoot } from "../lib/project-files.ts"
import { eventStream } from "../lib/sse.ts"
import { followActive } from "../modules/live/live-stream.ts"

/** The runs still going and the dashboard's queue, as server-sent events whenever they change. */
export const Route = createFileRoute("/api/active")({
  server: {
    handlers: {
      GET: ({ request }) => eventStream(request, (sink) => followActive(projectRoot(), sink)),
    },
  },
})
