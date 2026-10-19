import { Box, Stack, styled } from "@danwo/ui/jsx"
import { Link, useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { Button } from "../../components/controls.tsx"
import { Section } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { Row, RowList } from "../../components/table.tsx"
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
    <Row display="flex" alignItems="center" gap="3" flexWrap="wrap" data-live-run={run.id}>
      <LiveBadge word="running" />
      <Stack gap="0.5" minW="0" flex="1">
        <Link to="/runs/$runId" params={{ runId: run.id }}>
          <styled.span fontWeight="500" overflowWrap="anywhere">
            {run.title}
          </styled.span>
        </Link>
        <styled.span color="ink.muted" fontSize="1">
          {progress
            ? `${progress.done} of ${view.planned} done${progress.failed > 0 ? `, ${progress.failed} failed` : ""}`
            : "starting"}
        </styled.span>
      </Stack>
      <Ident fontSize="1" color="ink.soft">
        danwo {run.kind}
      </Ident>
      <styled.span color="ink.muted" fontSize="1" w="7rem" textAlign="right">
        <TimeAgo at={run.at} />
      </styled.span>
    </Row>
  )
}

/** A run the dashboard holds until the project is free. */
function QueuedLine({ label, position }: { readonly label: string; readonly position: number }) {
  return (
    <Row display="flex" alignItems="center" gap="3">
      <StatusBadge status="queued" />
      <styled.span flex="1" minW="0" overflowWrap="anywhere">
        {label}
      </styled.span>
      <Button
        type="button"
        look="ghost"
        h="7"
        onClick={() => void dropQueuedFn({ data: position })}
        aria-label={`Remove ${label} from the queue`}
      >
        Remove
      </Button>
    </Row>
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
        <RowList aria-label="Runs going">
          {active.map((run) => (
            <ActiveLine key={run.id} run={run} />
          ))}
          {queued.map((label, i) => (
            <QueuedLine key={`${label} ${i}`} label={label} position={i + 1} />
          ))}
        </RowList>
      </Section>
    </Box>
  )
}
