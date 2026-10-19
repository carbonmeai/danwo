/**
 * The browser's side of live runs: a run's feed as it streams in, the runs still going, and the
 * tab's title and icon saying how a run is doing.
 */
import type { LiveEvent } from "@danwo/runner/runner"
import { useEffect, useMemo, useState } from "react"

import { faviconWith } from "../layout/components/brand.tsx"
import type { LauncherState } from "./launcher.ts"
import type { ActiveRun } from "./live-data.ts"
import { foldLive, type LiveView } from "./live-values.ts"

/** One feed line as the stream carries it. */
function liveEventOf(message: MessageEvent<string>): LiveEvent {
  const event: LiveEvent = JSON.parse(message.data)

  return event
}

/**
 * Run `id` as its feed streams in, starting from `initial` (the server's first paint) until the
 * stream's first events replace it. Undefined until there is anything to show.
 */
export function useLiveRun(id: string, initial: LiveView | undefined): LiveView | undefined {
  const [events, setEvents] = useState<readonly LiveEvent[]>([])
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    const source = new EventSource(`/api/live/${encodeURIComponent(id)}`)
    const seen: LiveEvent[] = []

    setEvents([])
    source.addEventListener("live", (message) => {
      seen.push(liveEventOf(message))
      setEvents([...seen])
      if (seen.at(-1)?.type === "end") source.close()
    })
    source.addEventListener("stopped", () => {
      setStopped(true)
      source.close()
    })

    return () => source.close()
  }, [id])

  const streamed = useMemo(() => foldLive(events, !stopped), [events, stopped])

  return streamed ?? initial
}

/** What `/api/active` streams: the runs still going and what the dashboard has queued. */
export interface ActiveState {
  readonly active: readonly ActiveRun[]
  readonly launcher: LauncherState
}

/** The runs still going and the dashboard's queue, kept current; undefined until the first word. */
export function useActiveRuns(): ActiveState | undefined {
  const [state, setState] = useState<ActiveState>()

  useEffect(() => {
    const source = new EventSource("/api/active")

    source.addEventListener("runs", (message) => {
      const next: ActiveState = JSON.parse(message.data)

      setState(next)
    })

    return () => source.close()
  }, [])

  return state
}

const GREY = "#a2a7aa"

/** The tab icon's dot, by state. */
const DOTS: Readonly<Record<string, string>> = {
  running: "#2a78d6",
  passed: "#00c950",
  failed: "#e5484d",
  stopped: GREY,
}

/**
 * The tab says what a run is doing: its state first in the title, and a dot in that state's
 * colour on the icon. Both go back when the page does.
 */
export function useRunInTab(state: string | undefined, title: string): void {
  useEffect(() => (state === undefined ? undefined : showInTab(state, title)), [state, title])
}

/** Points the tab's icon at `href`; gives back what points it back. */
function swapIcon(href: string): () => void {
  const icon = document.querySelector<HTMLLinkElement>("link[rel=icon]")
  const before = icon?.getAttribute("href") ?? ""

  icon?.setAttribute("href", href)

  return () => icon?.setAttribute("href", before)
}

/** Puts the run's state in the tab; gives back what puts the tab back. */
function showInTab(state: string, title: string): () => void {
  const before = document.title
  const restoreIcon = swapIcon(faviconWith(DOTS[state] ?? GREY))

  document.title = `${state === "running" ? "● " : ""}${state} · ${title} · danwo`

  return () => {
    document.title = before
    restoreIcon()
  }
}
