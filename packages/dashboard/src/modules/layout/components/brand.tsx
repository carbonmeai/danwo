import { styled } from "@danwo/ui/jsx"

import { BRAND, BRAND_NAME } from "../brand.ts"

/** Which brand image: the horizontal lockup, the mark on its tile, or the bare glyph. */
type Kind = keyof typeof BRAND

/**
 * A brand image in the theme's version: the light-page file, swapped for the dark-page one under
 * the dark theme. `label` names it; without one it is decoration next to words that already say
 * the name.
 */
export function BrandImage({
  kind,
  height,
  label = BRAND_NAME,
  decorative = false,
}: {
  readonly kind: Kind
  readonly height: number
  readonly label?: string
  readonly decorative?: boolean
}) {
  const alt = decorative ? "" : label

  return (
    <>
      <styled.img
        src={BRAND[kind].onLight}
        alt={alt}
        height={height}
        flexShrink="0"
        display="block"
        _dark={{ display: "none" }}
        style={{ height }}
      />
      <styled.img
        src={BRAND[kind].onDark}
        alt={alt}
        height={height}
        flexShrink="0"
        display="none"
        _dark={{ display: "block" }}
        style={{ height }}
      />
    </>
  )
}
