/** danwo's mark: two overlapping squares, outlined and filled, on a near-black tile. */

/** The mark as an inline SVG data URL, for the favicon. */
export const BRAND_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="7" fill="#0a1217"/><g transform="translate(5.5 5.5) scale(.8125)"><rect x="2" y="2" width="8" height="8" rx="2" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="7" y="7" width="7" height="7" rx="1.6" fill="#fff"/></g></svg>',
)}`

/** The mark's two squares, drawn in white. */
export function Glyph({ size = 13 }: { readonly size?: number }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="8" height="8" rx="2" stroke="#fff" strokeWidth="1.6" />
      <rect x="7" y="7" width="7" height="7" rx="1.6" fill="#fff" />
    </svg>
  )
}

/** The mark on its tile, followed by the name. */
export function Brand() {
  return (
    <span className="danwo-brand">
      <span className="danwo-glyph">
        <Glyph />
      </span>
      danwo
    </span>
  )
}
