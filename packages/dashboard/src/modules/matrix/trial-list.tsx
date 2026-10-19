import type { MatrixHistory } from "@danwo/runner/runner"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import { useRef } from "react"

import { Ident } from "../../components/code.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { Row, RowList, RowPanel } from "../../components/table.tsx"
import { useListKeys } from "../../lib/list-keys.ts"
import { listedTrials } from "./matrix-values.ts"

/** The trials as a list, failures first, each with what went wrong. */
export function TrialList({ run }: { readonly run: MatrixHistory }) {
  const trials = listedTrials(run)
  const list = useRef<HTMLUListElement>(null)
  const current = useListKeys(list, trials.length)

  return (
    <RowPanel pt="1.5">
      <RowList ref={list} aria-label="Faults">
        {trials.map((trial, i) => (
          <Row
            key={trial.fault}
            data-row
            data-trial={trial.fault}
            data-status={trial.status}
            data-current={i === current || undefined}
            display="grid"
            gridTemplateColumns={{ base: "1fr", md: "8rem minmax(0, 1fr) 12rem" }}
            gap="3"
            alignItems="center"
          >
            <Box>
              <StatusBadge status={trial.status} />
            </Box>
            <Stack gap="1" minW="0">
              <Ident fontWeight="500">{trial.fault}</Ident>
              {trial.error ? (
                <Box color="verdict.failed.fg" fontSize="1" lineClamp="2">
                  {trial.error}
                </Box>
              ) : null}
            </Stack>
            <HStack gap="3" justify={{ md: "flex-end" }} color="ink.muted" fontSize="1">
              <span>
                {trial.calls} calls, {trial.deliveries} webhooks
              </span>
              {trial.record ? (
                <Link to="/records/$" params={{ _splat: trial.record }} data-link>
                  Record
                </Link>
              ) : null}
            </HStack>
          </Row>
        ))}
      </RowList>
    </RowPanel>
  )
}
