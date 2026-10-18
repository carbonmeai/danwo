import { css } from "@danwo/ui/css"
import { Box, Flex } from "@danwo/ui/jsx"
import * as RechartsPrimitive from "recharts"

import { useChart } from "./chart-container"

export const ChartTooltip = RechartsPrimitive.Tooltip

/**
 * recharts v3 moved payload and label into context for content-rendered
 * tooltips, so they are passed at runtime but absent from the prop type. They
 * are declared narrowly here rather than as any.
 */
export type TooltipItem = {
  dataKey?: string | number
  name?: string | number
  value?: number | string | null
  color?: string
}

const surface = css({
  bg: "background.popover",
  border: "subtle",
  display: "grid",
  gap: "1.5",
  glass: "popup",
  minW: "9rem",
  px: "2.5",
  py: "2",
  rounded: "lg",
  shadow: "sSm",
})

export const ChartTooltipContent = ({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: string | number
  labelFormatter?: (label: string | number) => string
  valueFormatter?: (value: number | string) => string
}) => {
  const { config } = useChart()

  if (!active || !payload?.length) {
    return null
  }

  return (
    <div className={surface}>
      {label === undefined ? null : (
        <Box fontSize="1" fontWeight="medium">
          {labelFormatter ? labelFormatter(label) : label}
        </Box>
      )}
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name ?? "value")
        const entry = config[key]

        /**
         * A null measure is skipped rather than shown as 0 — roughly a quarter
         * of filings do not report AUM, and the tooltip must not invent one.
         */
        if (item.value === null || item.value === undefined) {
          return null
        }

        return (
          <Flex align="center" gap="2.5" justify="space-between" key={key}>
            <Flex align="center" gap="1.5" minW="0">
              {/* inline for the same reason the legend swatch is */}
              <Box
                borderRadius="2px"
                flexShrink="0"
                h="0.625rem"
                style={{ backgroundColor: entry?.color ?? item.color }}
                w="0.625rem"
              />
              <Box color="text.muted" fontSize="1">
                {entry?.label ?? key}
              </Box>
            </Flex>
            <Box fontSize="1" fontWeight="medium">
              {valueFormatter ? valueFormatter(item.value) : item.value.toLocaleString()}
            </Box>
          </Flex>
        )
      })}
    </div>
  )
}
