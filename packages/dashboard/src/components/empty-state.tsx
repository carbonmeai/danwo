import { Box } from "@danwo/ui/jsx"
import { Card } from "@danwo/ui/primitives/card"
import { Text } from "@danwo/ui/primitives/typography"
import type { ReactNode } from "react"

import { BrandImage } from "../modules/layout/components/brand.tsx"
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
    <Card
      alignItems="center"
      gap="2.5"
      py="16"
      px="6"
      textAlign="center"
      bg="surface.panel"
      border="none"
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
        <BrandImage kind="glyph" height={18} decorative />
      </Box>
      <Text fontWeight="600" fontSize="15px">
        {title}
      </Text>
      <Box color="ink.muted" fontSize="1.5" maxW="32rem" data-prose>
        {hint}
      </Box>
      {command === undefined ? null : (
        <Box mt="1.5">
          <Command text={command} />
        </Box>
      )}
    </Card>
  )
}
