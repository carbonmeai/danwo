import { Box, Flex } from "@danwo/ui/jsx"

import type { ChartConfig } from "./chart-container"

/**
 * Takes the config directly rather than reading chart context: the legend sits
 * beside the chart, not inside it, and ChartContainer's children are handed
 * straight to recharts' ResponsiveContainer, which accepts a chart element only.
 *
 * Driven by the config rather than by recharts' legend payload, so a series
 * keeps its swatch even when every value in view is null — an absent series is
 * not the same as one that was never asked for.
 */
export const ChartLegend = ({ config }: { config: ChartConfig }) => (
  <Flex align="center" flexWrap="wrap" gap="4" pb="2">
    {Object.entries(config).map(([key, item]) => (
      <Flex align="center" gap="1.5" key={key}>
        {/* inline: panda extracts styles at build time, so a runtime colour
            passed to bg emits no css at all */}
        <Box
          borderRadius="2px"
          flexShrink="0"
          h="0.625rem"
          style={{ backgroundColor: item.color }}
          w="0.625rem"
        />
        <Box color="text.muted" fontSize="1">
          {item.label ?? key}
        </Box>
      </Flex>
    ))}
  </Flex>
)
