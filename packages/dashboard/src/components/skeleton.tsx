import { Box, Stack } from "@danwo/ui/jsx"

/** A grey block standing in for content that is still loading. */
function Block({ w, h }: { readonly w: string; readonly h: string }) {
  return <Box w={w} h={h} rounded="md" bg="signal.raised" animation="pulsate" />
}

/** What any page shows while its data loads: a title, a summary band and rows. */
export function PageSkeleton() {
  return (
    <Stack gap="6" aria-busy="true" aria-label="Loading">
      <Stack gap="2">
        <Block w="16rem" h="7" />
        <Block w="24rem" h="4" />
      </Stack>
      <Block w="full" h="7rem" />
      <Stack gap="2">
        {Array.from({ length: 8 }, (_, i) => (
          <Block key={i} w="full" h="10" />
        ))}
      </Stack>
    </Stack>
  )
}
