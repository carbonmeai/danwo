import { Box, Grid, styled } from "@danwo/ui/jsx"
import type { ReactNode } from "react"

/** One bar of a bar list. */
export interface Bar {
  readonly key: string
  readonly label: ReactNode
  readonly value: number
  /** How the value reads beside its bar. */
  readonly shown: string
  readonly tone?: "accent" | "failed" | "flaky" | "quiet"
}

const FILL = {
  accent: "series.1",
  failed: "verdict.failed.solid",
  flaky: "verdict.flaky.solid",
  quiet: "series.other",
} as const

/** A ranked list: each name with its value on the right and a thin bar beneath, the largest full width. */
export function BarList({
  bars,
  label,
}: {
  readonly bars: readonly Bar[]
  readonly label: string
}) {
  const top = Math.max(...bars.map((bar) => bar.value), 0) || 1

  return (
    <styled.ol aria-label={label} display="grid" gap="1.5">
      {bars.map((bar) => (
        <Grid
          as="li"
          key={bar.key}
          data-row
          gridTemplateColumns="minmax(0, 1fr) auto"
          columnGap="2.5"
          rowGap="1.5"
          alignItems="center"
          py="1"
        >
          <Box minW="0" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
            {bar.label}
          </Box>
          <Box textAlign="right" fontVariantNumeric="tabular-nums">
            {bar.shown}
          </Box>
          <Box gridColumn="1 / -1" h="1" bg="surface.track" rounded="full" overflow="hidden">
            <Box
              h="full"
              rounded="full"
              bg={FILL[bar.tone ?? "accent"]}
              style={{ width: `${Math.max((bar.value / top) * 100, 1.5)}%` }}
            />
          </Box>
        </Grid>
      ))}
    </styled.ol>
  )
}
