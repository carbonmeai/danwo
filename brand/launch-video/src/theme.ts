import { loadFont } from "@remotion/fonts"
import { staticFile } from "remotion"

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

/** The dashboard's dark palette, as the README hero uses it. */
export const C = {
  bg: "#0a0a0a",
  panel: "#121213",
  raised: "#18181a",
  line: "rgb(255 255 255 / 0.09)",
  text: "#ffffff",
  muted: "#a3a3a6",
  faint: "#6e6e73",
  pass: "#22c55e",
  fail: "#f05252",
  blue: "#3b82f6",
} as const

/**
 * Chinese characters and full-width punctuation come from Noto Sans SC, first in each stack but
 * limited to those characters, so Latin text stays in Inter and Geist Mono, and `？` and `：` are
 * drawn full width rather than as Inter's narrow forms. English text has none of these characters.
 */
const CJK = "'Noto Sans SC'"

export const SANS = `${CJK}, Inter, sans-serif`
export const MONO = `${CJK}, 'Geist Mono', monospace`

void loadFont({ family: "Inter", url: staticFile("fonts/InterVariable.woff2"), weight: "100 900" })
/** Cut to the characters the Chinese copy uses (`bun run font:zh` remakes it). */
void loadFont({
  family: "Noto Sans SC",
  url: staticFile("fonts/NotoSansSC-subset.woff2"),
  weight: "100 900",
  unicodeRange: "U+3000-303F, U+3400-9FFF, U+FF00-FFEF",
})
void loadFont({
  family: "Geist Mono",
  url: staticFile("fonts/GeistMono-Variable.woff2"),
  weight: "100 900",
})
