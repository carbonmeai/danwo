import type { HistoryTrial } from "@danwo/runner/runner"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { Ident } from "../../components/code.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"

/** One trial in full: the fault, its verdict, what went wrong and where its record is. */
export function TrialDetail({
  testId,
  trial,
}: {
  readonly testId: string
  readonly trial: HistoryTrial | undefined
}) {
  if (trial === undefined) return <Box color="ink.muted">Point at a cell to see its trial.</Box>

  return (
    <Stack gap="3" data-detail={trial.fault ?? "clean run"}>
      <HStack>
        <StatusBadge status={trial.status} />
      </HStack>
      <Ident fontSize="1.5" fontWeight="500" color="ink.strong">
        {trial.fault ?? "clean run"}
      </Ident>
      {trial.error ? (
        <Box
          color="verdict.failed.fg"
          bg="verdict.failed.bg"
          rounded="lg"
          px="2.5"
          py="2"
          overflowWrap="anywhere"
        >
          {trial.error}
        </Box>
      ) : null}
      {trial.notes.map((note) => (
        <Box key={note} color="ink.muted">
          {note}
        </Box>
      ))}
      <Box color="ink.muted">
        {trial.calls} provider {trial.calls === 1 ? "call" : "calls"}, {trial.deliveries}{" "}
        {trial.deliveries === 1 ? "webhook" : "webhooks"} delivered
      </Box>
      {trial.source ? (
        <Box color="ink.muted">
          Stopped at <Ident>{`${trial.source.file}:${trial.source.line}`}</Ident>
        </Box>
      ) : null}
      {trial.record ? (
        <Link
          to="/tests/$testId"
          params={{ testId }}
          search={{ record: trial.record, tab: "steps" }}
          data-link
        >
          Watch this trial's recording
        </Link>
      ) : (
        <Box color="ink.faint">No flight record was kept for this trial.</Box>
      )}
    </Stack>
  )
}
