import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import { useRef } from "react"

import { None } from "../../components/panel.tsx"
import { StatusBadge, Swatch } from "../../components/status-badge.tsx"
import { Row, RowList } from "../../components/table.tsx"
import { useListKeys } from "../../lib/list-keys.ts"
import { toneOf, wordOf } from "../../lib/verdicts.ts"
import type { Insights, Outcome } from "./insights-data.ts"

/** A test's verdict in each run it appeared in, oldest on the left. */
function OutcomeStrip({ outcomes }: { readonly outcomes: readonly Outcome[] }) {
  return (
    <HStack gap="1" flexWrap="wrap" aria-label="Verdict per run, oldest first">
      {outcomes.map((outcome) => (
        <Link
          key={outcome.run}
          to="/runs/$runId"
          params={{ runId: outcome.run }}
          title={`${wordOf(outcome.status)} in ${outcome.run}`}
          aria-label={`${wordOf(outcome.status)} in ${outcome.run}`}
        >
          <Swatch tone={toneOf(outcome.status)} w="1.5" h="5" rounded="xs" display="block" />
        </Link>
      ))}
    </HStack>
  )
}

/** The tests that flipped between passing and failing, each with its verdict in every run. */
export function FlakyTests({ insights }: { readonly insights: Insights }) {
  const list = useRef<HTMLUListElement>(null)
  const current = useListKeys(list, insights.flaky.length)

  if (insights.flaky.length === 0)
    return (
      <None>
        No test has flipped between passing and failing. A test that passes only on a retry shows up
        here, with its verdict in every run.
      </None>
    )

  return (
    <RowList ref={list} aria-label="Flaky tests">
      {insights.flaky.map((test, i) => (
        <Row key={test.id} data-row data-current={i === current || undefined}>
          <Grid
            gridTemplateColumns={{ base: "1fr", md: "minmax(0, 2fr) minmax(0, 2fr) 9rem" }}
            gap="3"
            alignItems="center"
          >
            <Stack gap="0.5" minW="0">
              <Link to="/tests/$testId" params={{ testId: test.id }}>
                <styled.span fontWeight="500" overflowWrap="anywhere">
                  {test.id}
                </styled.span>
              </Link>
              <styled.span color="ink.muted" fontSize="1">
                {test.flaky} flaky, {test.failed} failed, {test.flips}{" "}
                {test.flips === 1 ? "flip" : "flips"} in {test.runs} runs
              </styled.span>
            </Stack>
            <OutcomeStrip outcomes={insights.history[test.id] ?? []} />
            <Box justifySelf={{ md: "end" }}>
              <StatusBadge status={test.lastStatus} />
            </Box>
          </Grid>
        </Row>
      ))}
    </RowList>
  )
}
