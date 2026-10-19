import { HStack, styled } from "@danwo/ui/jsx"

/**
 * danwo's mark: the app in front, and the layer behind it that danwo watches, offset so both
 * show. Drawn in the current text colour with the accent behind.
 */
function Mark({ size = 20 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="13" height="13" rx="3" fill="var(--danwo-colors-signal-accent)" />
      <rect
        x="3"
        y="3"
        width="13"
        height="13"
        rx="3"
        fill="var(--danwo-colors-signal-panel)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  )
}

/** The mark with the name beside it, as the top bar shows it. */
export function Wordmark() {
  return (
    <HStack gap="2" color="signal.ink">
      <Mark />
      <styled.span fontWeight="600" fontSize="3" letterSpacing="-0.01em">
        danwo
      </styled.span>
    </HStack>
  )
}

/** The mark as an SVG data URL, for the favicon. */
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="3" fill="#2c5bd8"/><rect x="3" y="3" width="13" height="13" rx="3" fill="#fff" stroke="#151a21" stroke-width="2"/></svg>',
)}`
