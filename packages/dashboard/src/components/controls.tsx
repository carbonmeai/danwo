import { css } from "@danwo/ui/css"
import { Icons } from "@danwo/ui/icons/base"
import { HStack, styled } from "@danwo/ui/jsx"
import { Kbd } from "@danwo/ui/primitives/kbd"
import type { RefObject } from "react"

/** A segmented control's grey track; its segments are links or buttons styled with `segment`. */
export const SegmentTrack = styled("div", {
  base: { display: "inline-flex", bg: "surface.hover", rounded: "10px", p: "0.5", gap: "0.5" },
})

/** One segment: muted on the track, a white lifted chip when it is the one shown. */
export const segment = css({
  display: "inline-flex",
  alignItems: "center",
  h: "7",
  px: "3",
  rounded: "lg",
  fontSize: "1.5",
  fontWeight: "500",
  color: "ink.muted",
  whiteSpace: "nowrap",
  cursor: "pointer",
  _hover: { color: "ink.strong" },
  "&[data-on]": { bg: "surface.chip", color: "ink.strong", boxShadow: "chip" },
})

/** A button: grey by default, the one solid fill for the page's main action. */
export const Button = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.5",
    h: "8",
    px: "3",
    rounded: "lg",
    fontSize: "1.5",
    fontWeight: "500",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "background 120ms",
  },
  variants: {
    look: {
      grey: { bg: "surface.hover", color: "ink.strong", _hover: { bg: "surface.track" } },
      primary: { bg: "ink.solid", color: "ink.onSolid", _hover: { bg: "ink.solidHover" } },
      ghost: { color: "ink.soft", _hover: { bg: "surface.hover", color: "ink.strong" } },
    },
  },
  defaultVariants: { look: "grey" },
})

/** The filter box a list jumps to on `/`: filled, no border, a ring on focus. */
const FilterInput = styled("input", {
  base: {
    h: "7",
    pl: "8",
    pr: "2.5",
    w: { base: "full", sm: "16rem" },
    rounded: "lg",
    bg: "surface.hover",
    color: "ink.strong",
    fontSize: "1",
    outline: "none",
    transition: "background 120ms, box-shadow 120ms",
    _placeholder: { color: "ink.faint" },
    _hover: { bg: "surface.active" },
    _focus: { bg: "surface.panel", boxShadow: "0 0 0 3px {colors.ring}" },
  },
})

/** The keys a list answers to. */
export function KeyHint({ filter = false }: { readonly filter?: boolean }) {
  return (
    <HStack gap="1" color="ink.muted" fontSize="1" display={{ base: "none", lg: "flex" }}>
      <Kbd>j</Kbd>
      <Kbd>k</Kbd>
      <span>{filter ? "to move," : "to move"}</span>
      {filter ? (
        <>
          <Kbd>/</Kbd>
          <span>to filter</span>
        </>
      ) : null}
    </HStack>
  )
}

/** A list's key hints and its filter box. */
export function ListFilter({
  label,
  placeholder,
  filter,
}: {
  readonly label: string
  readonly placeholder: string
  readonly filter: {
    readonly query: string
    readonly setQuery: (query: string) => void
    readonly box: RefObject<HTMLInputElement | null>
  }
}) {
  return (
    <HStack gap="3">
      <KeyHint filter />
      <styled.label
        position="relative"
        display="flex"
        alignItems="center"
        w={{ base: "full", sm: "auto" }}
      >
        <Icons.searchNormal size={14} position="absolute" left="2.5" color="ink.faint" />
        <FilterInput
          ref={filter.box}
          type="search"
          placeholder={placeholder}
          aria-label={label}
          value={filter.query}
          onChange={(event) => filter.setQuery(event.target.value)}
        />
      </styled.label>
    </HStack>
  )
}
