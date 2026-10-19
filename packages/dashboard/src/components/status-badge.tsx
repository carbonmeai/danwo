import { Box, HStack, styled } from "@danwo/ui/jsx"

import { type Share, toneOf, wordOf } from "../lib/verdicts.ts"
import { Ident } from "./code.tsx"

/** A soft label in a verdict's colour: 22px tall, rounded, no border. */
export const Badge = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "1.5",
    h: "22px",
    px: "2",
    rounded: "lg",
    fontSize: "1",
    fontWeight: "500",
    whiteSpace: "nowrap",
    lineHeight: "1",
  },
  variants: {
    tone: {
      passed: { bg: "verdict.passed.bg", color: "verdict.passed.fg" },
      failed: { bg: "verdict.failed.bg", color: "verdict.failed.fg" },
      flaky: { bg: "verdict.flaky.bg", color: "verdict.flaky.fg" },
      notJudged: { bg: "verdict.notJudged.bg", color: "verdict.notJudged.fg" },
      invalid: { bg: "verdict.invalid.bg", color: "verdict.invalid.fg" },
    },
  },
  defaultVariants: { tone: "invalid" },
})

/** A filled swatch in a verdict's colour, for grids, dots and legends. */
export const Swatch = styled("span", {
  base: { display: "inline-block", rounded: "sm", flexShrink: "0" },
  variants: {
    tone: {
      passed: { bg: "verdict.passed.solid" },
      failed: { bg: "verdict.failed.solid" },
      flaky: { bg: "verdict.flaky.solid" },
      notJudged: { bg: "verdict.notJudged.solid" },
      invalid: { bg: "verdict.invalid.solid" },
    },
  },
})

/** A status as a small coloured label with its dot; unknown statuses read neutral. */
export function StatusBadge({ status }: { readonly status: string }) {
  const tone = toneOf(status)

  return (
    <Badge tone={tone} data-status={status}>
      <Swatch tone={tone} w="1.5" h="1.5" rounded="full" />
      {wordOf(status)}
    </Badge>
  )
}

/** A run's verdicts as one proportional bar: how much passed, failed and so on, at a glance. */
export function VerdictStrip({
  shares,
  width = "8rem",
}: {
  readonly shares: readonly Share[]
  readonly width?: string
}) {
  const total = shares.reduce((sum, share) => sum + share.count, 0)

  if (total === 0) return <Box w={width} h="1" rounded="full" bg="surface.track" />

  return (
    <HStack
      gap="0.5"
      w={width}
      h="1"
      aria-hidden="true"
      title={shares
        .filter((s) => s.count > 0)
        .map((s) => `${s.count} ${s.label}`)
        .join(", ")}
    >
      {shares
        .filter((share) => share.count > 0)
        .map((share) => (
          <Swatch
            key={share.label}
            tone={share.tone}
            h="full"
            rounded="full"
            style={{ flexGrow: share.count, flexBasis: 0 }}
          />
        ))}
    </HStack>
  )
}

/** A lint rule with a dot in its severity's colour. */
export function LintLabel({
  rule,
  severity,
}: {
  readonly rule: string
  readonly severity: string
}) {
  return (
    <HStack gap="2" minW="0">
      <Swatch tone={severity === "error" ? "failed" : "flaky"} w="2" h="2" rounded="full" />
      <Ident>{rule}</Ident>
    </HStack>
  )
}
