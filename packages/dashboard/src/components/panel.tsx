import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import type { ReactNode } from "react"

/** A faint grey section on the white page, for a group of related content. No border. */
export const Panel = styled("div", {
  base: { bg: "surface.panel", rounded: "14px", minW: "0" },
  variants: {
    pad: {
      none: {},
      card: { px: "4", py: "3.5" },
      section: { px: "4", pt: "3.5", pb: "4" },
    },
  },
  defaultVariants: { pad: "section" },
})

/** A white surface that sits on a panel: a detail card, a step, a trial. */
export const Item = styled("div", {
  base: { bg: "surface.item", rounded: "10px", minW: "0" },
})

/**
 * A titled section of a page: a grey panel whose heading names the region for screen readers, with
 * a count beside it and anything else on the right.
 */
export function Section({
  title,
  count,
  aside,
  bare = false,
  children,
}: {
  readonly title: string
  readonly count?: number
  readonly aside?: ReactNode
  /** Leave the content off the panel, for content that brings its own surfaces. */
  readonly bare?: boolean
  readonly children: ReactNode
}) {
  const heading = (
    <HStack justify="space-between" gap="4" mb="2.5" flexWrap="wrap" minH="7">
      <styled.h2 fontSize="1.5" fontWeight="600">
        {title}
        {count === undefined ? null : (
          <styled.span color="ink.muted" fontWeight="400" ml="1.5">
            {count}
          </styled.span>
        )}
      </styled.h2>
      {aside}
    </HStack>
  )

  return bare ? (
    <Box as="section" mt="6" aria-label={title}>
      {heading}
      {children}
    </Box>
  ) : (
    <Panel as="section" mt="2" aria-label={title}>
      {heading}
      {children}
    </Panel>
  )
}

/** One summary card: a muted label, the figure, and a line or a small chart beneath. */
export function StatCard({
  label,
  icon,
  value,
  sub,
  chart,
}: {
  readonly label: string
  readonly icon?: ReactNode
  readonly value: ReactNode
  readonly sub?: ReactNode
  readonly chart?: ReactNode
}) {
  return (
    <Panel pad="card" display="flex" flexDirection="column" gap="1" data-card={label}>
      <HStack gap="1.5" color="ink.muted" fontSize="1" fontWeight="500">
        {icon}
        {label}
      </HStack>
      <styled.span
        fontSize="5.5"
        fontWeight="600"
        letterSpacing="-0.015em"
        lineHeight="1.3"
        fontVariantNumeric="tabular-nums"
      >
        {value}
      </styled.span>
      {sub === undefined ? null : (
        <HStack
          gap="1.5"
          color="ink.muted"
          fontSize="1"
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {sub}
        </HStack>
      )}
      {chart === undefined ? null : (
        <Box h="7" mt="1.5">
          {chart}
        </Box>
      )}
    </Panel>
  )
}

/** A row of summary cards: two across on a phone, three to five on wide screens. */
export const StatCards = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "2",
    mb: "2",
  },
  variants: {
    columns: {
      3: { lg: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } },
      4: { lg: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } },
      5: { lg: { gridTemplateColumns: "repeat(5, minmax(0, 1fr))" } },
    },
  },
  defaultVariants: { columns: 4 },
})

/** A line of muted text on a panel, for a section with nothing in it. */
export function None({ children }: { readonly children: ReactNode }) {
  return (
    <Stack color="ink.muted" fontSize="1.5" py="1">
      {children}
    </Stack>
  )
}
