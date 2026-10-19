import { Box, Stack, styled } from "@danwo/ui/jsx"
import type { ReactNode } from "react"

import { Command } from "./code.tsx"

/** What a page shows when there is nothing to show yet, and the command that fills it. */
export function Empty({
  title,
  hint,
  command,
}: {
  readonly title: string
  readonly hint: ReactNode
  readonly command?: string
}) {
  return (
    <Stack
      alignItems="center"
      gap="2.5"
      py="16"
      px="6"
      textAlign="center"
      bg="surface.panel"
      rounded="2xl"
      data-empty
    >
      <Box
        display="grid"
        placeItems="center"
        w="10"
        h="10"
        rounded="10px"
        bg="surface.chip"
        boxShadow="chip"
        color="ink.muted"
        mb="1"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="13" height="13" rx="3" fill="currentColor" opacity="0.3" />
          <rect
            x="3"
            y="3"
            width="13"
            height="13"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeDasharray="3 2"
          />
        </svg>
      </Box>
      <styled.p fontWeight="600" fontSize="15px">
        {title}
      </styled.p>
      <Box color="ink.muted" fontSize="1.5" maxW="32rem" data-prose>
        {hint}
      </Box>
      {command === undefined ? null : (
        <Box mt="1.5">
          <Command text={command} />
        </Box>
      )}
    </Stack>
  )
}
