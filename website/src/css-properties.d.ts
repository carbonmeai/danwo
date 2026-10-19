/** Inline styles may set CSS custom properties, which the landing page's styles read. */
import type { CSSProperties as ReactCss } from "react"

declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined
  }
}

/** Inline styles, custom properties included. */
export type Style = ReactCss
