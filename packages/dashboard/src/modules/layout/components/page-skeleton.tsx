import { Box, Grid, Stack } from "@danwo/ui/jsx"
import { Skeleton } from "@danwo/ui/primitives/skeleton"

/**
 * What any page shows while its data loads: the top bar, then a title, summary cards with their
 * figures pulsing, and rows on a panel.
 */
export function PageSkeleton() {
  return (
    <Box aria-busy="true" aria-label="Loading">
      <Box h="11" boxShadow="inset 0 -1px 0 {colors.hairline}" />
      <Stack maxW="1120px" mx="auto" px={{ base: "4", md: "6" }} pt="10" gap="6">
        <Stack gap="2">
          <Skeleton h="5" w="12rem" rounded="md" />
          <Skeleton h="3.5" w="22rem" maxW="full" rounded="md" />
        </Stack>
        <Grid gridTemplateColumns={{ base: "1fr 1fr", lg: "repeat(4, minmax(0, 1fr))" }} gap="2">
          {Array.from({ length: 4 }, (_, i) => (
            <Stack key={i} gap="2.5" bg="surface.panel" rounded="14px" px="4" py="3.5">
              <Skeleton h="3" w="5rem" rounded="sm" />
              <Skeleton h="5" w="4rem" rounded="md" />
            </Stack>
          ))}
        </Grid>
        <Stack gap="3px" bg="surface.panel" rounded="14px" p="1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Box
              key={i}
              h="12"
              bg="surface.item"
              rounded="lg"
              px="3"
              display="flex"
              alignItems="center"
            >
              <Skeleton h="3" w={i % 2 === 0 ? "40%" : "28%"} rounded="sm" />
            </Box>
          ))}
        </Stack>
      </Stack>
    </Box>
  )
}
