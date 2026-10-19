import { Box, HStack, Stack } from "@danwo/ui/jsx"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  type CardProps,
  CardTitle,
} from "@danwo/ui/primitives/card"
import { Heading, Span, Text } from "@danwo/ui/primitives/typography"
import type { ComponentProps, ReactNode } from "react"

/**
 * A faint grey section on the white page, for a group of related content: the library's card on
 * the panel fill, with no border.
 */
export function Panel(props: CardProps) {
  return (
    <Card
      bg="surface.panel"
      border="none"
      rounded="14px"
      gap="0"
      py="3.5"
      px="4"
      minW="0"
      overflow="visible"
      {...props}
    />
  )
}

/** A white card that sits on a panel: a detail card, a step, a trial. */
export function Item(props: CardProps) {
  return (
    <Card
      size="sm"
      bg="surface.item"
      border="none"
      rounded="10px"
      gap="0"
      minW="0"
      overflow="visible"
      {...props}
    />
  )
}

/**
 * A titled section of a page: a card whose heading names the region for screen readers, with a
 * count beside it and anything else on the right.
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
    <Heading as="h2" fontSize="1.5" fontWeight="600">
      {title}
      {count === undefined ? null : (
        <Span color="ink.muted" fontWeight="400" ml="1.5">
          {count}
        </Span>
      )}
    </Heading>
  )

  if (bare)
    return (
      <Box as="section" mt="6" aria-label={title}>
        <HStack justify="space-between" gap="4" mb="2.5" flexWrap="wrap" minH="7">
          {heading}
          {aside}
        </HStack>
        {children}
      </Box>
    )

  return (
    <Card
      role="region"
      aria-label={title}
      mt="2"
      bg="surface.panel"
      border="none"
      rounded="14px"
      gap="2.5"
      pt="3.5"
      pb="4"
      minW="0"
      overflow="visible"
    >
      <CardHeader alignItems="center" minH="7">
        <CardTitle>{heading}</CardTitle>
        {aside === undefined ? null : <CardAction alignSelf="center">{aside}</CardAction>}
      </CardHeader>
      <CardContent minW="0">{children}</CardContent>
    </Card>
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
    <Panel gap="1" data-card={label}>
      <HStack gap="1.5" color="ink.muted" fontSize="1" fontWeight="500">
        {icon}
        {label}
      </HStack>
      <Span
        fontSize="5.5"
        fontWeight="600"
        letterSpacing="-0.015em"
        lineHeight="1.3"
        fontVariantNumeric="tabular-nums"
      >
        {value}
      </Span>
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
export function StatCards({
  columns = 4,
  children,
}: {
  readonly columns?: 3 | 4 | 5
  readonly children: ReactNode
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={{
        base: "repeat(2, minmax(0, 1fr))",
        lg:
          columns === 3
            ? "repeat(3, minmax(0, 1fr))"
            : columns === 5
              ? "repeat(5, minmax(0, 1fr))"
              : "repeat(4, minmax(0, 1fr))",
      }}
      gap="2"
      mb="2"
    >
      {children}
    </Box>
  )
}

/** A line of muted text on a panel, for a section with nothing in it. */
export function None({ children }: { readonly children: ReactNode }) {
  return (
    <Text color="ink.muted" fontSize="1.5" py="1">
      {children}
    </Text>
  )
}

/** A list of white rows on a panel, announced as a list. */
export function ListRows({ children, ...props }: ComponentProps<typeof Stack>) {
  return (
    <Stack role="list" gap="3px" {...props}>
      {children}
    </Stack>
  )
}

/** One white row of a list. */
export function ListRow(props: ComponentProps<typeof Box>) {
  return (
    <Box
      role="listitem"
      bg="surface.item"
      rounded="lg"
      px="3"
      py="2.5"
      minH="12"
      transition="background 120ms"
      _hover={{ bg: "surface.itemHover" }}
      {...props}
    />
  )
}
