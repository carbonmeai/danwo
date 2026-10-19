import { Box, Grid, Stack } from "@danwo/ui/jsx"
import { Span } from "@danwo/ui/primitives/typography"

import { TrendLine } from "../../components/charts.tsx"
import { Item, None } from "../../components/panel.tsx"
import { percent, when } from "../../lib/format.ts"
import type { CachePoint } from "./insights-data.ts"

/** How much of each run's agent work the replay cache answered, latest figure first. */
export function CacheTrend({ points }: { readonly points: readonly CachePoint[] }) {
  if (points.length === 0)
    return (
      <None>
        No run has used the replay cache yet. Agent steps record on their first run and replay
        without the model after that.
      </None>
    )

  const last = points.at(-1)
  const average = points.reduce((sum, p) => sum + p.rate, 0) / points.length

  return (
    <Item px="4" py="3.5">
      <Grid
        gridTemplateColumns={{ base: "1fr", md: "12rem minmax(0, 1fr)" }}
        gap="6"
        alignItems="center"
      >
        <Stack gap="1">
          <Span
            fontSize="5.5"
            fontWeight="600"
            letterSpacing="-0.015em"
            fontVariantNumeric="tabular-nums"
          >
            {percent(last?.rate ?? null)}
          </Span>
          <Span color="ink.muted" fontSize="1">
            of agent steps replayed in the latest run, {percent(average)} on average
          </Span>
        </Stack>
        <Box overflow="hidden">
          <TrendLine
            values={points.map((p) => p.rate)}
            labels={points.map((p) => when(p.startedAt))}
            range={[0, 1]}
            height="5rem"
            axis={false}
            format={(value) => percent(value)}
            label={`Replay cache hit rate per run, from ${when(points[0]?.startedAt ?? "")} to ${when(last?.startedAt ?? "")}`}
          />
        </Box>
      </Grid>
    </Item>
  )
}
