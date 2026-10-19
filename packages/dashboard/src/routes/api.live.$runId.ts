import { createFileRoute } from "@tanstack/react-router"

import { projectRoot } from "../lib/project-files.ts"
import { eventStream } from "../lib/sse.ts"
import { isRunId } from "../modules/live/live-data.ts"
import { followFeed } from "../modules/live/live-stream.ts"

/** One run's live feed as server-sent events, from its first line to its last. */
export const Route = createFileRoute("/api/live/$runId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        isRunId(params.runId)
          ? eventStream(request, (sink) => followFeed(projectRoot(), params.runId, sink))
          : new Response("Not found", { status: 404 }),
    },
  },
})
