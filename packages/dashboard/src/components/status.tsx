import { Box, Stack, styled } from "@danwo/ui/jsx"
import { Badge } from "@danwo/ui/primitives/badge"
import type { ReactNode } from "react"

/** The palette each status reads in, so a failure looks the same on every page. */
const PALETTE: Readonly<Record<string, string>> = {
  passed: "brand.success",
  matched: "brand.success",
  replayed: "brand.success",
  failed: "brand.error",
  diverged: "brand.error",
  "timed-out": "brand.error",
  interrupted: "brand.error",
  "environment-error": "brand.error",
  flaky: "brand.warning",
  relocated: "brand.warning",
  "handed-off": "brand.warning",
  stale: "brand.warning",
  partial: "brand.warning",
  "not-judged": "brand.info",
  blocked: "brand.info",
  inconclusive: "brand.info",
  invalid: "brand.secondary",
  missed: "brand.secondary",
}

/** A status as a small coloured label; unknown statuses read neutral. */
export function StatusBadge({ status }: { readonly status: string }) {
  return (
    <Badge colorPalette={PALETTE[status] ?? "gray"} data-status={status}>
      {status}
    </Badge>
  )
}

/** A page's heading line with optional detail under it. */
export function PageTitle({
  title,
  detail,
}: {
  readonly title: string
  readonly detail?: ReactNode
}) {
  return (
    <Stack gap="1" mb="6">
      <styled.h1 fontSize="4" fontWeight="semibold">
        {title}
      </styled.h1>
      {detail === undefined ? null : (
        <Box color="text.secondary" fontSize="1">
          {detail}
        </Box>
      )}
    </Stack>
  )
}

/** What a page shows when there is nothing to show yet, and how to get something. */
export function Empty({ title, hint }: { readonly title: string; readonly hint: ReactNode }) {
  return (
    <Stack align="center" gap="2" py="16" textAlign="center" data-empty>
      <styled.p fontWeight="medium">{title}</styled.p>
      <Box color="text.secondary" fontSize="1" maxW="32rem">
        {hint}
      </Box>
    </Stack>
  )
}

/** A short monospace span, for commands, codes and routes. */
export const Code = styled("code", {
  base: { fontFamily: "mono", fontSize: "1", bg: "background.muted", px: "1", rounded: "sm" },
})
