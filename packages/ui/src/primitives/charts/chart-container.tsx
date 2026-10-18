import { Box } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react"
import * as RechartsPrimitive from "recharts"

export type ChartConfig = {
  [key: string]: {
    label?: ReactNode
    color?: string
  }
}

const ChartContext = createContext<{ config: ChartConfig } | null>(null)

export const useChart = () => {
  const context = useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

/**
 * Series colours reach recharts as CSS variables rather than props, so a series
 * can be referenced as var(--color-<key>) from anywhere inside the chart —
 * including the tooltip, which recharts renders outside the SVG tree.
 */
const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const coloured = Object.entries(config).filter(([, item]) => item.color)

  if (coloured.length === 0) {
    return null
  }

  return (
    <style>
      {`[data-chart="${id}"] { ${coloured
        .map(([key, item]) => `--color-${key}: ${item.color};`)
        .join(" ")} }`}
    </style>
  )
}

export const ChartContainer = ({
  id,
  children,
  config,
  ...props
}: JsxStyleProps & {
  id?: string
  config: ChartConfig
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"]
}) => {
  const generated = useId()
  const chartId = `chart-${id ?? generated.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <Box data-chart={chartId} display="flex" justifyContent="center" {...props}>
        <ChartStyle config={config} id={chartId} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </Box>
    </ChartContext.Provider>
  )
}
