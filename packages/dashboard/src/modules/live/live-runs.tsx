import { Icons } from "@danwo/ui/icons/base"
import { Box, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span } from "@danwo/ui/primitives/typography"
import { Link, useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { ListRow, ListRows, Section } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { dropQueuedFn } from "./live-api.ts"
import type { ActiveRun } from "./live-data.ts"
import { LiveBadge } from "./live-run-page.tsx"
import { progressOf } from "./live-values.ts"
import { type ActiveState, useActiveRuns, useLiveRun, useRunInTab } from "./use-live.ts"

/** A run still going: its state breathing, how far along it is, a link to watch it. */
function ActiveLine({ run }: { readonly run: ActiveRun }) {
  const view = useLiveRun(run.id, undefined)
  const progress = view && progressOf(view)

  return (
    <ListRow display="flex" alignItems="center" gap="3" flexWrap="wrap" data-live-run={run.id}>
      <LiveBadge word="running" />
      <Stack gap="0.5" minW="0" flex="1">
        <Link to="/runs/$runId" params={{ runId: run.id }}>
          <Span fontWeight="500" overflowWrap="anywhere">
            {run.title}
          </Span>
        </Link>
        <Span color="ink.muted" fontSize="1">
          {progress
            ? `${progress.done} of ${view.planned} done${progress.failed > 0 ? `, ${progress.failed} failed` : ""}`
            : "starting"}
        </Span>
      </Stack>
      <Ident fontSize="1" color="ink.soft">
        danwo {run.kind}
      </Ident>
      <Span color="ink.muted" fontSize="1" w="7rem" textAlign="right">
        <TimeAgo at={run.at} />
      </Span>
    </ListRow>
  )
}

/** A run the dashboard holds until the project is free. */
function QueuedLine({ label, position }: { readonly label: string; readonly position: number }) {
  return (
    <ListRow display="flex" alignItems="center" gap="3">
      <StatusBadge status="queued" />
      <Span flex="1" minW="0" overflowWrap="anywhere">
        {label}
      </Span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void dropQueuedFn({ data: position })}
        aria-label={`Remove ${label} from the queue`}
      >
        <Icons.trash size={13} />
        Remove
      </Button>
    </ListRow>
  )
}

/** Reloads the runs list when a run that was going is gone from the list: it just finished. */
function useReloadWhenDone(state: ActiveState | undefined): void {
  const router = useRouter()
  const seen = useRef<readonly string[]>([])

  useEffect(() => {
    if (state === undefined) return

    const now = state.active.map((run) => run.id)
    const finished = seen.current.some((id) => !now.includes(id))

    seen.current = now
    if (finished) void router.invalidate()
  }, [state, router])
}

/**
 * The runs going right now and the ones waiting, above the finished runs. Nothing shows when the
 * project is quiet.
 */
export function LiveRuns() {
  const state = useActiveRuns()
  const active = state?.active ?? []
  const queued = state?.launcher.queued ?? []

  useReloadWhenDone(state)
  useRunInTab(active.length > 0 ? "running" : undefined, `${active.length} running`)

  if (active.length === 0 && queued.length === 0) return null

  return (
    <Box mb="2">
      <Section title="Running now" count={active.length + queued.length}>
        <ListRows aria-label="Runs going">
          {active.map((run) => (
            <ActiveLine key={run.id} run={run} />
          ))}
          {queued.map((label, i) => (
            <QueuedLine key={`${label} ${i}`} label={label} position={i + 1} />
          ))}
        </ListRows>
      </Section>
    </Box>
  )
}
