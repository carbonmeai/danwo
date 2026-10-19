/**
 * The brand's files, imported from the repository's `brand/` folder so it stays their one source:
 * the bundler serves each as a URL, and the favicon's SVG as text to draw the live dot over.
 */
import faviconIco from "../../../../../brand/favicon.ico?url"
import appleTouchIcon from "../../../../../brand/png/apple-touch-icon.png?url"
import glyphBlack from "../../../../../brand/svg/danwo-glyph-black.svg?url"
import glyphWhite from "../../../../../brand/svg/danwo-glyph-white.svg?url"
import lockupOnDark from "../../../../../brand/svg/danwo-lockup-horizontal-on-dark.svg?url"
import lockupOnLight from "../../../../../brand/svg/danwo-lockup-horizontal-on-light.svg?url"
import markOnDark from "../../../../../brand/svg/danwo-mark-on-dark.svg?url"
import markOnLight from "../../../../../brand/svg/danwo-mark-on-light.svg?url"
import faviconSvg from "../../../../../brand/svg/favicon.svg?raw"
import faviconSvgUrl from "../../../../../brand/svg/favicon.svg?url"

/** How the logo reads, for alt text. */
export const BRAND_NAME = "dánwò"

/** Each brand image in its light-page and dark-page version. */
export const BRAND = {
  lockup: { onLight: lockupOnLight, onDark: lockupOnDark },
  mark: { onLight: markOnLight, onDark: markOnDark },
  glyph: { onLight: glyphBlack, onDark: glyphWhite },
} as const

/** The links a page's head carries for the browser's and the home screen's icons. */
export const ICON_LINKS = [
  { rel: "icon", href: faviconIco, sizes: "any" },
  { rel: "icon", href: faviconSvgUrl, type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: appleTouchIcon },
] as const

/**
 * The brand favicon as an SVG data URL with a dot of colour `dot` in its top-right corner, for the
 * tab of a page watching a run; the plain favicon without one.
 */
export function faviconWith(dot?: string): string {
  if (dot === undefined) return faviconSvgUrl

  const badge = `<circle cx="52" cy="12" r="11" fill="${dot}" stroke="#fff" stroke-width="3"/>`
  const svg = faviconSvg.trim().replace(/<\/svg>$/, `${badge}</svg>`)

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
