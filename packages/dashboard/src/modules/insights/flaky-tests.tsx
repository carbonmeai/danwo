import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useRef } from "react"

import { ListRow, ListRows, None } from "../../components/panel.tsx"
import { BlockBone, Bone } from "../../components/skeleton.tsx"
import { StatusBadge, Swatch } from "../../components/status-badge.tsx"
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

/** A flaky test's row: the test, its verdict in each run, and its latest verdict. */
function FlakyColumns({ children }: { readonly children: ReactNode }) {
  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", md: "minmax(0, 2fr) minmax(0, 2fr) 9rem" }}
      gap="3"
      alignItems="center"
    >
      {children}
    </Grid>
  )
}

/** A flaky test's row while the insights load, its columns those of the loaded row. */
export function FlakyTestSkeleton() {
  return (
    <ListRows>
      <ListRow data-skeleton-row _hover={{}}>
        <FlakyColumns>
          <Stack gap="0.5" minW="0">
            <Bone w="90%" />
            <Bone w="50%" />
            <Bone w="11rem" fontSize="1" />
          </Stack>
          <BlockBone w="9rem" h="5" rounded="xs" />
          <Bone w="4rem" justifySelf={{ md: "end" }} />
        </FlakyColumns>
      </ListRow>
    </ListRows>
  )
}

/** The tests that flipped between passing and failing, each with its verdict in every run. */
export function FlakyTests({ insights }: { readonly insights: Insights }) {
  const list = useRef<HTMLDivElement>(null)
  const current = useListKeys(list, insights.flaky.length)

  if (insights.flaky.length === 0)
    return (
      <None>
        No test has flipped between passing and failing. A test that passes only on a retry shows up
        here, with its verdict in every run.
      </None>
    )

  return (
    <ListRows ref={list} aria-label="Flaky tests">
      {insights.flaky.map((test, i) => (
        <ListRow
          key={test.id}
          data-row
          bg={i === current ? "surface.itemHover" : "surface.item"}
          boxShadow={i === current ? "inset 2px 0 0 {colors.ink.strong}" : undefined}
        >
          <FlakyColumns>
            <Stack gap="0.5" minW="0">
              <Link to="/tests" search={{ q: test.id }}>
                <Span fontWeight="500" overflowWrap="anywhere">
                  {test.id}
                </Span>
              </Link>
              <Span color="ink.muted" fontSize="1">
                {test.flaky} flaky, {test.failed} failed, {test.flips}{" "}
                {test.flips === 1 ? "flip" : "flips"} in {test.runs} runs
              </Span>
            </Stack>
            <OutcomeStrip outcomes={insights.history[test.id] ?? []} />
            <Box justifySelf={{ md: "end" }}>
              <StatusBadge status={test.lastStatus} />
            </Box>
          </FlakyColumns>
        </ListRow>
      ))}
    </ListRows>
  )
}
