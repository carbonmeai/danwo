import { Box, Grid, Stack, styled } from "@danwo/ui/jsx"

import { None } from "../../components/panel.tsx"
import { Sparkline } from "../../components/sparkline.tsx"
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
    <Grid
      gridTemplateColumns={{ base: "1fr", md: "12rem minmax(0, 1fr)" }}
      gap="6"
      alignItems="center"
      bg="surface.item"
      rounded="10px"
      px="4"
      py="3.5"
    >
      <Stack gap="1">
        <styled.span
          fontSize="5.5"
          fontWeight="600"
          letterSpacing="-0.015em"
          fontVariantNumeric="tabular-nums"
        >
          {percent(last?.rate ?? null)}
        </styled.span>
        <styled.span color="ink.muted" fontSize="1">
          of agent steps replayed in the latest run, {percent(average)} on average
        </styled.span>
      </Stack>
      <Box overflow="hidden">
        <Sparkline
          values={points.map((p) => p.rate)}
          range={[0, 1]}
          width={640}
          height={72}
          fluid
          label={`Replay cache hit rate per run, from ${when(points[0]?.startedAt ?? "")} to ${when(last?.startedAt ?? "")}`}
        />
      </Box>
    </Grid>
  )
}
