/**
 * What the live endpoints stream: one run's feed, line by line as the run writes it, and the list
 * of runs still going with whatever the dashboard has queued. Both read files on a short timer;
 * nothing here writes.
 */
import type { EventSink } from "../../lib/sse.ts"
import { launcherState } from "./launcher.ts"
import { activeRuns, feedPath, isAlive, readFrom } from "./live-data.ts"
import { parseFeed } from "./live-values.ts"

/** How often a followed feed is read for new lines. */
const FEED_EVERY_MS = 250
/** How often the list of runs still going is looked at again. */
const ACTIVE_EVERY_MS = 1_000

/**
 * Sends every line of run `id`'s feed as a `live` event, from the top, then each new one as it
 * lands. Ends after the run's last line, or with a `stopped` event when its process went away first.
 */
export function followFeed(root: string, id: string, sink: EventSink): () => void {
  const path = feedPath(root, id)
  let offset = 0
  let pid: number | undefined
  let busy = false

  /** Sends the new lines; true once the run's last line went out. */
  const forward = (text: string): boolean => {
    for (const event of parseFeed(text)) {
      if (event.type === "run") pid = event.pid
      sink.send("live", event)
      if (event.type === "end") return true
    }

    return false
  }

  /** Ends the stream with a `stopped` event when the run's process went away. */
  const checkGone = () => {
    if (pid === undefined || isAlive(pid)) return

    sink.send("stopped", { id })
    sink.close()
  }

  const read = async () => {
    if (busy) return

    busy = true

    try {
      const { text, next } = await readFrom(path, offset)

      offset = next

      return forward(text) ? sink.close() : checkGone()
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => void read(), FEED_EVERY_MS)

  void read()

  return () => clearInterval(timer)
}

/** Sends the runs still going and the dashboard's queue as a `runs` event whenever they change. */
export function followActive(root: string, sink: EventSink): () => void {
  let last = ""

  const look = async () => {
    const state = { active: await activeRuns(root), launcher: launcherState() }
    const text = JSON.stringify(state)

    if (text === last) return

    last = text
    sink.send("runs", state)
  }

  const timer = setInterval(() => void look(), ACTIVE_EVERY_MS)

  void look()

  return () => clearInterval(timer)
}
