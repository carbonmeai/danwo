import { HStack, styled } from "@danwo/ui/jsx"
import { Skeleton } from "@danwo/ui/primitives/skeleton"
import { TableCell, TableRow } from "@danwo/ui/primitives/table"
import type { ComponentProps, ReactNode } from "react"

import { ListRow, ListRows, Panel, StatCard } from "./panel.tsx"

type Width = ComponentProps<typeof Skeleton>["w"]

/**
 * A line of text still loading. The bar is sized in `em` and sits in a line box like a word, so
 * it takes the font size and line height of the text it stands in for, and the line keeps the
 * height it has once the text arrives. `inline` keeps it inside a sentence; otherwise it is a
 * line of its own, `w` wide.
 */
export function Bone({
  w,
  inline = false,
  ...props
}: { readonly w: Width; readonly inline?: boolean } & ComponentProps<typeof styled.span>) {
  const bar = (
    <Skeleton
      display="inline-block"
      verticalAlign="middle"
      h="0.9em"
      maxW="full"
      rounded="sm"
      w={inline ? w : "full"}
    />
  )

  if (inline) return bar

  return (
    <styled.span display="block" w={w} maxW="full" {...props}>
      {bar}
    </styled.span>
  )
}

/** A small control still loading, at the library's small size: a dropdown, a search box, a button. */
export function ControlBone({ w }: { readonly w: Width }) {
  return <Skeleton h="8" w={w} rounded="lg" flexShrink="0" />
}

/** A block still loading, such as a chart or a thumbnail, filling the box it is given. */
export function BlockBone(props: ComponentProps<typeof Skeleton>) {
  return <Skeleton rounded="lg" {...props} />
}

/** Line widths that read as real text without reshuffling on every render. */
const WIDTHS = ["72%", "54%", "88%", "63%", "47%", "79%"] as const

/** A width for the `i`th of a run of lines, so a list of them looks like ragged text. */
export const lineWidth = (i: number): string => WIDTHS[i % WIDTHS.length] ?? "60%"

/** `count` copies of a placeholder row, each told its index. */
export function Repeat({
  count,
  children,
}: {
  readonly count: number
  readonly children: (i: number) => ReactNode
}) {
  return <>{Array.from({ length: count }, (_, i) => children(i))}</>
}

/** A summary card whose figure is still loading: the card's own label and icon, then bones. */
export function StatCardSkeleton({
  label,
  icon,
}: {
  readonly label: string
  readonly icon: ReactNode
}) {
  return <StatCard label={label} icon={icon} value={<Bone w="4rem" />} sub={<Bone w="9rem" />} />
}

/** A list row still loading: a line of text, and a shorter one under it when `lines` is 2. */
export function ListRowSkeleton({ i, lines = 1 }: { readonly i: number; readonly lines?: 1 | 2 }) {
  return (
    <ListRow data-skeleton-row display="flex" flexDirection="column" justifyContent="center">
      <Bone w={lineWidth(i)} />
      {lines === 2 ? <Bone w="9rem" fontSize="1" mt="1.5" /> : null}
    </ListRow>
  )
}

/** A panel of list rows still loading, as the lists of trials and of anything else sit. */
export function ListPanelSkeleton({
  count,
  lines,
}: {
  readonly count: number
  readonly lines?: 1 | 2
}) {
  return (
    <Panel px="1.5" py="1.5">
      <ListRows>
        <Repeat count={count}>{(i) => <ListRowSkeleton key={i} i={i} lines={lines} />}</Repeat>
      </ListRows>
    </Panel>
  )
}

/**
 * A row's icon buttons still loading, right-aligned as the real ones sit: each the library's
 * small icon button's square, with its icon as a bone in the middle.
 */
export function ActionsBone({ count }: { readonly count: number }) {
  return (
    <HStack gap="0.5" justify="flex-end">
      <Repeat count={count}>
        {(i) => (
          <HStack key={i} w="1.75rem" h="1.75rem" justify="center" flexShrink="0">
            <Skeleton w="3.5" h="3.5" rounded="sm" />
          </HStack>
        )}
      </Repeat>
    </HStack>
  )
}

/** A table row still loading, one cell per column, marked so a test can find it. */
export function BoneRow({ children }: { readonly children: ReactNode }) {
  return (
    <TableRow data-skeleton-row _hover={{ bg: "transparent" }}>
      {children}
    </TableRow>
  )
}

/**
 * A table cell whose content is still loading: it takes the real column's props, and holds its
 * children, or a line `bone` wide, or nothing.
 */
export function BoneCell({
  bone,
  children,
  ...props
}: { readonly bone?: Width; readonly children?: ReactNode } & ComponentProps<typeof TableCell>) {
  return (
    <TableCell {...props}>{children ?? (bone === undefined ? null : <Bone w={bone} />)}</TableCell>
  )
}
