import type { HistoryTrial, MatrixHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { ListRow, ListRows, Panel } from "../../components/panel.tsx"
import { DeletedRecording, useRecordings } from "../../components/recordings.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { WhoseBadge } from "../../components/whose-badge.tsx"
import { useListKeys } from "../../lib/list-keys.ts"
import { listedTrials } from "./matrix-values.ts"

/** Plays a trial's recording over the page; says so when it was deleted with its run. */
function TrialWatch({ record }: { readonly record: string | undefined }) {
  const recordings = useRecordings()

  if (record === undefined) return null
  if (recordings?.pruned) return <DeletedRecording keepRuns={recordings.keepRuns} />

  return (
    <Button asChild variant="ghost" size="icon" tooltipChildren="Watch this trial">
      <Link
        to="."
        search={(prev) => ({ ...prev, open: record })}
        resetScroll={false}
        aria-label="Watch"
      >
        <Icons.play size={14} />
      </Link>
    </Button>
  )
}

/** One trial: its status and whose failure it was, its fault and error, its counts and replay. */
function TrialLine({
  run,
  trial,
  picked,
}: {
  readonly run: MatrixHistory
  readonly trial: HistoryTrial
  readonly picked: boolean
}) {
  return (
    <ListRow
      data-row
      data-trial={trial.fault}
      data-status={trial.status}
      bg={picked ? "surface.itemHover" : "surface.item"}
      boxShadow={picked ? "inset 2px 0 0 {colors.ink.strong}" : undefined}
      display="grid"
      gridTemplateColumns={{ base: "1fr", md: "8rem minmax(0, 1fr) 14rem" }}
      gap="3"
      alignItems="center"
    >
      <Stack gap="1" alignItems="flex-start">
        <StatusBadge status={trial.status} />
        {trial.verdict && trial.status !== "passed" ? <WhoseBadge verdict={trial.verdict} /> : null}
      </Stack>
      <Stack gap="1" minW="0">
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          search={{ view: "list", trial: trial.fault ?? undefined }}
          replace
          title="A link to this trial"
        >
          <Ident fontWeight="500">{trial.fault}</Ident>
        </Link>
        {trial.error ? (
          <Box color="verdict.failed.fg" fontSize="1" lineClamp="2">
            {trial.error}
          </Box>
        ) : null}
      </Stack>
      <HStack gap="2" justify={{ md: "flex-end" }} color="ink.muted" fontSize="1">
        <Span>
          {trial.calls} calls, {trial.deliveries} webhooks
        </Span>
        <TrialWatch record={trial.record} />
      </HStack>
    </ListRow>
  )
}

/** The trials as a list, failures first, each with what went wrong. */
export function TrialList({
  run,
  focus,
}: {
  readonly run: MatrixHistory
  /** The trial the page's address points at, by its fault. */
  readonly focus?: string | undefined
}) {
  const trials = listedTrials(run)
  const list = useRef<HTMLDivElement>(null)
  const current = useListKeys(list, trials.length)

  useEffect(() => {
    if (focus === undefined) return

    list.current
      ?.querySelector(`[data-trial="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "center" })
  }, [focus])

  return (
    <Panel px="1.5" py="1.5">
      <ListRows ref={list} aria-label="Faults">
        {trials.map((trial, i) => (
          <TrialLine
            key={trial.fault}
            run={run}
            trial={trial}
            picked={i === current || trial.fault === focus}
          />
        ))}
      </ListRows>
    </Panel>
  )
}
