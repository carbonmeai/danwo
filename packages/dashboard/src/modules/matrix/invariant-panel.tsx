import type { MatrixHistory } from "@danwo/runner/runner"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { Item, Panel } from "../../components/panel.tsx"
import { Badge, StatusBadge, VerdictStrip } from "../../components/status-badge.tsx"
import { invariantSummary, ruleOf } from "./matrix-values.ts"

/** What the matrix asks of the app, and how much of it held. */
export function InvariantPanel({ run }: { readonly run: MatrixHistory }) {
  const summary = invariantSummary(run)

  return (
    <Panel as="section" aria-label="Invariant" pad="none" px="5" py="18px" mb="2">
      <Grid gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }} gap="8">
        <Stack gap="2.5">
          <Box color="ink.muted" fontSize="1" fontWeight="500">
            {summary.label}
          </Box>
          <styled.p fontSize="2" fontWeight="500" lineHeight="1.5" maxW="44rem">
            {ruleOf(run)}
          </styled.p>
          <HStack gap="2" color="ink.muted" flexWrap="wrap">
            <span>The clean run, with no fault:</span>
            <StatusBadge status={run.clean.status} />
            {run.clean.record ? (
              <Link to="/records/$" params={{ _splat: run.clean.record }} data-link>
                Open its flight record
              </Link>
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
            <Badge tone={summary.broke ? "failed" : "passed"}>
              {summary.broke ? "Broke" : "Held"}
            </Badge>
            {run.trials.length} {summary.faults} after the clean run
          </HStack>
          <styled.p fontSize="5.5" fontWeight="600" letterSpacing="-0.015em" lineHeight="1.3">
            {summary.headline}
            <styled.span color="ink.muted" fontSize="2" fontWeight="400" ml="1.5">
              {summary.faults}
            </styled.span>
          </styled.p>
          <VerdictStrip width="100%" shares={summary.shares} />
        </Item>
      </Grid>
    </Panel>
  )
}
