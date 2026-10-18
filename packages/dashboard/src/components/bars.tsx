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
  accent: "signal.accent",
  failed: "verdict.failed.solid",
  flaky: "verdict.flaky.solid",
  quiet: "signal.ruleStrong",
} as const

/** A ranked list drawn as horizontal bars, the largest value spanning the track. */
export function BarList({
  bars,
  label,
}: {
  readonly bars: readonly Bar[]
  readonly label: string
}) {
  const top = Math.max(...bars.map((bar) => bar.value), 0) || 1

  return (
    <styled.ol aria-label={label} display="grid" gap="2.5">
      {bars.map((bar) => (
        <Grid
          as="li"
          key={bar.key}
          data-row
          gridTemplateColumns={{ base: "1fr 5rem", md: "minmax(0, 2fr) minmax(6rem, 3fr) 5rem" }}
          columnGap="4"
          rowGap="1"
          alignItems="center"
        >
          <Box
            minW="0"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            fontSize="1.5"
          >
            {bar.label}
          </Box>
          <Box
            gridColumn={{ base: "1 / -1", md: "auto" }}
            gridRow={{ base: "2", md: "auto" }}
            h="2"
            bg="signal.raised"
            rounded="full"
            overflow="hidden"
          >
            <Box
              h="full"
              rounded="full"
              bg={FILL[bar.tone ?? "accent"]}
              style={{ width: `${Math.max((bar.value / top) * 100, 1.5)}%` }}
            />
          </Box>
          <Box textAlign="right" fontSize="1.5" fontWeight="500" color="signal.ink">
            {bar.shown}
          </Box>
        </Grid>
      ))}
    </styled.ol>
  )
}
