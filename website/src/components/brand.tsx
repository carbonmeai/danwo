/**
 * The dánwò brand on the site: the horizontal lockup and the mark, served from `/brand/`, which
 * the build copies from the repository's `brand/` folder. Each is drawn twice, one for light
 * surfaces and one for dark, and the theme shows the right one.
 */

/** Where the copied brand files are served. */
const BRAND = "/brand/svg"

/** The horizontal lockup's width over its height. */
const LOCKUP_RATIO = 726.36 / 168

/** The lockup, `height` pixels tall; `className` lets a dark surface force its on-dark version. */
export function Lockup({
  height = 24,
  className = "",
}: {
  readonly height?: number
  readonly className?: string
}) {
  const width = Math.round(height * LOCKUP_RATIO)

  return (
    <span className={`danwo-lockup ${className}`.trim()}>
      <img
        className="only-light"
        src={`${BRAND}/danwo-lockup-horizontal-on-light.svg`}
        alt="dánwò"
        width={width}
        height={height}
      />
      <img
        className="only-dark"
        src={`${BRAND}/danwo-lockup-horizontal-on-dark.svg`}
        alt="dánwò"
        width={width}
        height={height}
      />
    </span>
  )
}

/** The mark on its tile, `size` pixels square. */
export function Mark({ size = 18 }: { readonly size?: number }) {
  return (
    <span className="danwo-mark">
      <img
        className="only-light"
        src={`${BRAND}/danwo-mark-on-light.svg`}
        alt=""
        width={size}
        height={size}
      />
      <img
        className="only-dark"
        src={`${BRAND}/danwo-mark-on-dark.svg`}
        alt=""
        width={size}
        height={size}
      />
    </span>
  )
}
