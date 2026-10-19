import { defineSemanticTokens } from "@pandacss/dev"

/**
 * The dashboard's palette: grey on white. Sections are a faint grey panel on the white page, rows and
 * chips sit white on the panel, and there are no borders, only the shell's hairlines. Colour is kept
 * for verdicts and charts, so a failure reads the same on every page.
 */
export const signalColors = defineSemanticTokens.colors({
  surface: {
    page: { value: { base: "#ffffff", _dark: "#0d0d0d" } },
    sidebar: { value: { base: "#f7f7f7", _dark: "#131313" } },
    /** A section's fill on the page. */
    panel: { value: { base: "#0a121706", _dark: "#e8e8e80a" } },
    /** A row or card that sits on a panel. */
    item: { value: { base: "#ffffff", _dark: "#1b1b1b" } },
    itemHover: { value: { base: "#fafafa", _dark: "#202020" } },
    /** The lifted chip: an active segment, a key, a selected row. */
    chip: { value: { base: "#ffffff", _dark: "#2e2e2e" } },
    pop: { value: { base: "#ffffff", _dark: "#1b1b1b" } },
    /** Hover and track fills, as alpha on whatever is beneath. */
    hover: { value: { base: "#0a12170d", _dark: "#e8e8e80d" } },
    active: { value: { base: "#0a12170f", _dark: "#e8e8e80f" } },
    track: { value: { base: "#0a121714", _dark: "#e8e8e814" } },
  },
  ink: {
    strong: { value: { base: "#0a1217", _dark: "#ededed" } },
    soft: { value: { base: "#3c4449", _dark: "#c6c6c6" } },
    muted: { value: { base: "#6f7579", _dark: "#8e8e8e" } },
    faint: { value: { base: "#a2a7aa", _dark: "#5e5e5e" } },
    /** The one solid fill: primary buttons and the brand mark. */
    solid: { value: { base: "#0a1217", _dark: "#ededed" } },
    solidHover: { value: { base: "#243036", _dark: "#ffffff" } },
    onSolid: { value: { base: "#ffffff", _dark: "#0d0d0d" } },
  },
  /** The shell's hairlines and chart grid lines; nothing else draws a line. */
  hairline: { value: { base: "#0a121710", _dark: "#e8e8e812" } },
  ring: { value: { base: "#0a12171f", _dark: "#e8e8e829" } },
  /** Categorical chart series, in order. */
  series: {
    1: { value: { base: "#2a78d6", _dark: "#3987e5" } },
    2: { value: { base: "#eb6834", _dark: "#d95926" } },
    3: { value: { base: "#1baf7a", _dark: "#199e70" } },
    4: { value: { base: "#eda100", _dark: "#c98500" } },
    other: { value: { base: "#a2a7aa", _dark: "#5e5e5e" } },
  },
  verdict: {
    passed: {
      fg: { value: { base: "#00851a", _dark: "#3ddc78" } },
      bg: { value: { base: "#00c9501a", _dark: "#00c95021" } },
      solid: { value: { base: "#00c950", _dark: "#00c950" } },
    },
    failed: {
      fg: { value: { base: "#c4262c", _dark: "#ff7479" } },
      bg: { value: { base: "#e5484d17", _dark: "#e5484d21" } },
      solid: { value: { base: "#e5484d", _dark: "#e5484d" } },
    },
    flaky: {
      fg: { value: { base: "#9a5b00", _dark: "#f5b84f" } },
      bg: { value: { base: "#f5a5241f", _dark: "#f5a5241f" } },
      solid: { value: { base: "#f5a524", _dark: "#f5a524" } },
    },
    notJudged: {
      fg: { value: { base: "#1f63b8", _dark: "#6aa8f0" } },
      bg: { value: { base: "#2a78d61a", _dark: "#3987e521" } },
      solid: { value: { base: "#2a78d6", _dark: "#3987e5" } },
    },
    invalid: {
      fg: { value: { base: "#3c4449", _dark: "#c6c6c6" } },
      bg: { value: { base: "#0a12170d", _dark: "#e8e8e80d" } },
      solid: { value: { base: "#0a121733", _dark: "#e8e8e840" } },
    },
  },
})

/** The dashboard's two lifts: a chip off its track, and a menu or tooltip off the page. */
export const signalShadows = defineSemanticTokens.shadows({
  chip: {
    value: {
      base: "0 1px 2px rgba(10,18,23,.06), 0 1px 1px rgba(10,18,23,.03)",
      _dark: "0 1px 2px rgba(0,0,0,.4)",
    },
  },
  pop: {
    value: {
      base: "0 12px 32px rgba(10,18,23,.12), 0 2px 6px rgba(10,18,23,.06)",
      _dark: "0 14px 36px rgba(0,0,0,.6), 0 0 0 1px #e8e8e80a",
    },
  },
})
