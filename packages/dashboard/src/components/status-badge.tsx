import { cva, cx } from "@danwo/ui/css"
import { Box, HStack } from "@danwo/ui/jsx"
import { Badge } from "@danwo/ui/primitives/badge"
import type { ComponentProps, ReactNode } from "react"

import { type Share, type Tone, toneOf, wordOf } from "../lib/verdicts.ts"
import { Ident } from "./code.tsx"

type BadgeProps = ComponentProps<typeof Badge>

/**
 * The library's soft badge in each verdict's palette, so a failure looks the same on every page.
 * The palettes are written out per verdict so the style extractor sees each one.
 */
const BADGE: Readonly<Record<Tone, (props: BadgeProps) => ReactNode>> = {
  passed: (props) => <Badge look="soft" size="md" colorPalette="palette.green" {...props} />,
  failed: (props) => <Badge look="soft" size="md" colorPalette="palette.red" {...props} />,
  flaky: (props) => <Badge look="soft" size="md" colorPalette="palette.amber" {...props} />,
  notJudged: (props) => <Badge look="soft" size="md" colorPalette="palette.blue" {...props} />,
  invalid: (props) => <Badge look="soft" size="md" colorPalette="palette.gray" {...props} />,
}

/** Each verdict's solid fill, for swatches. */
const fill = cva({
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

/** The library's soft badge in a verdict's colour. */
export function VerdictBadge({
  tone = "invalid",
  ...props
}: BadgeProps & { readonly tone?: Tone | undefined }) {
  const Shown = BADGE[tone]

  return <Shown gap="1.5" whiteSpace="nowrap" {...props} />
}

/** A filled swatch in a verdict's colour, for grids, dots and legends. */
export function Swatch({
  tone,
  className,
  ...props
}: ComponentProps<typeof Box> & { readonly tone: Tone }) {
  return (
    <Box
      display="inline-block"
      rounded="sm"
      flexShrink="0"
      className={cx(fill({ tone }), className)}
      {...props}
    />
  )
}

/** A status as a small coloured label with its dot; unknown statuses read neutral. */
export function StatusBadge({ status }: { readonly status: string }) {
  const tone = toneOf(status)

  return (
    <VerdictBadge tone={tone} data-status={status}>
      <Swatch tone={tone} w="1.5" h="1.5" rounded="full" />
      {wordOf(status)}
    </VerdictBadge>
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
