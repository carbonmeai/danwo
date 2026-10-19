import { Box, HStack, styled } from "@danwo/ui/jsx"

/**
 * danwo's mark on its solid tile: the app in front, and the layer behind it that danwo watches,
 * offset so both show.
 */
export function Mark({ size = 20 }: { readonly size?: number }) {
  return (
    <Box
      display="inline-grid"
      placeItems="center"
      flexShrink="0"
      rounded="6px"
      bg="ink.solid"
      color="ink.onSolid"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="9" y="9" width="12" height="12" rx="2.5" fill="currentColor" opacity="0.45" />
        <rect
          x="3"
          y="3"
          width="12"
          height="12"
          rx="2.5"
          fill="var(--danwo-colors-ink-solid)"
          stroke="currentColor"
          strokeWidth="2.2"
        />
      </svg>
    </Box>
  )
}

/** The mark with the name beside it, as the sidebar shows it. */
export function Wordmark() {
  return (
    <HStack gap="1.5" color="ink.strong">
      <Mark />
      <styled.span fontWeight="600" fontSize="2">
        danwo
      </styled.span>
    </HStack>
  )
}

/** The mark as an SVG data URL for the favicon, with a dot of colour `dot` in its corner if given. */
export function faviconWith(dot?: string): string {
  const badge =
    dot === undefined
      ? ""
      : `<circle cx="19" cy="5" r="5" fill="${dot}" stroke="#fff" stroke-width="1.5"/>`

  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0a1217"/><g transform="translate(3.6 3.6) scale(.7)"><rect x="9" y="9" width="12" height="12" rx="2.5" fill="#fff" opacity=".45"/><rect x="3" y="3" width="12" height="12" rx="2.5" fill="#0a1217" stroke="#fff" stroke-width="2.2"/></g>${badge}</svg>`,
  )}`
}

/** The mark as an SVG data URL, for the favicon. */
export const FAVICON = faviconWith()
