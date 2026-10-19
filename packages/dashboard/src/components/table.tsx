import { styled } from "@danwo/ui/jsx"

/**
 * Tables and lists read as white rows on a grey panel: each row its own rounded surface, three
 * pixels apart, the header row bare above them. Hover, the keyboard's current row and a picked row
 * lighten the row through `--row-bg` and mark its edge through `--row-edge`.
 */
export const RowPanel = styled("div", {
  base: { bg: "surface.panel", rounded: "14px", px: "1.5", pt: "0.5", pb: "1.5", minW: "0" },
})

export const RowTable = styled("table", {
  base: {
    w: "full",
    borderCollapse: "separate",
    borderSpacing: "0 3px",
    fontSize: "1.5",
    "& tbody tr": {
      _hover: { "--row-bg": "{colors.surface.itemHover}" },
      "&[data-current], &[data-picked]": {
        "--row-bg": "{colors.surface.itemHover}",
        "--row-edge": "inset 2px 0 0 {colors.ink.strong}",
      },
    },
  },
})

export const Th = styled("th", {
  base: {
    textAlign: "left",
    fontWeight: "500",
    color: "ink.muted",
    fontSize: "1",
    px: "3",
    h: "30px",
    whiteSpace: "nowrap",
  },
})

export const Td = styled("td", {
  base: {
    bg: "var(--row-bg, {colors.surface.item})",
    px: "3",
    py: "2",
    h: "12",
    verticalAlign: "middle",
    transition: "background 120ms",
    _first: { roundedLeft: "lg", boxShadow: "var(--row-edge, none)" },
    _last: { roundedRight: "lg" },
  },
})

/** A list of white rows on a panel. */
export const RowList = styled("ul", {
  base: { display: "grid", gap: "3px" },
})

/** One white row of a list. */
export const Row = styled("li", {
  base: {
    bg: "var(--row-bg, {colors.surface.item})",
    boxShadow: "var(--row-edge, none)",
    rounded: "lg",
    px: "3",
    py: "2.5",
    minH: "12",
    transition: "background 120ms",
    _hover: { "--row-bg": "{colors.surface.itemHover}" },
    "&[data-current], &[data-picked]": {
      "--row-bg": "{colors.surface.itemHover}",
      "--row-edge": "inset 2px 0 0 {colors.ink.strong}",
    },
  },
})
