import type { MatrixHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span, Text } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"

import { Item, Panel } from "../../components/panel.tsx"
import { StatusBadge, VerdictBadge, VerdictStrip } from "../../components/status-badge.tsx"
import { invariantSummary, ruleOf } from "./matrix-values.ts"

/** What the matrix asks of the app, and how much of it held. */
export function InvariantPanel({ run }: { readonly run: MatrixHistory }) {
  const summary = invariantSummary(run)

  return (
    <Panel role="region" aria-label="Invariant" px="5" py="18px" mb="2">
      <Grid gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }} gap="8">
        <Stack gap="2.5">
          <Box color="ink.muted" fontSize="1" fontWeight="500">
            {summary.label}
          </Box>
          <Text fontSize="2" fontWeight="500" lineHeight="1.5" maxW="44rem">
            {ruleOf(run)}
          </Text>
          <HStack gap="2" color="ink.muted" flexWrap="wrap">
            <Span>The clean run, with no fault:</Span>
            <StatusBadge status={run.clean.status} />
            {run.clean.record ? (
              <Button asChild variant="ghost" size="sm">
                <Link
                  to="."
                  search={(prev) => ({ ...prev, open: run.clean.record })}
                  resetScroll={false}
                >
                  <Icons.play size={13} />
                  Watch the clean run
                </Link>
              </Button>
            ) : null}
          </HStack>
        </Stack>
        <Item
          display="flex"
          flexDirection="column"
          gap="2.5"
          justifyContent="center"
          px="4"
          py="3.5"
        >
          <HStack gap="2" color="ink.muted" fontSize="1" fontWeight="500">
            <VerdictBadge tone={summary.broke ? "failed" : "passed"}>
              {summary.broke ? "Broke" : "Held"}
            </VerdictBadge>
            {run.trials.length} {summary.faults} after the clean run
          </HStack>
          <Text fontSize="5.5" fontWeight="600" letterSpacing="-0.015em" lineHeight="1.3">
            {summary.headline}
            <Span color="ink.muted" fontSize="2" fontWeight="400" ml="1.5">
              {summary.faults}
            </Span>
          </Text>
          <VerdictStrip width="100%" shares={summary.shares} />
        </Item>
      </Grid>
    </Panel>
  )
}
