import { Box } from "@danwo/ui/jsx"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@danwo/ui/primitives/charts"
import type { TooltipItem } from "@danwo/ui/primitives/charts/chart-tooltip"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

/** A value on a trend line, null where the run had nothing to plot. */
export type TrendValue = number | null

/** One point of a trend: where it sits along the axis and its value. */
interface TrendPoint {
  readonly at: string
  readonly value: TrendValue
}

const GRID = "var(--danwo-colors-hairline)"
const TICK = { fontSize: 11, fill: "var(--danwo-colors-ink-faint)" } as const

/** What recharts hands a tooltip's content: whether it shows, the hovered entries, their label. */
interface TipProps {
  readonly active?: boolean
  readonly payload?: readonly {
    readonly dataKey?: unknown
    readonly name?: string | number
    readonly value?: unknown
    readonly color?: string
  }[]
  readonly label?: string | number
}

/** The hovered entries as the library's tooltip reads them. */
function itemsOf(payload: TipProps["payload"]): TooltipItem[] {
  return (payload ?? []).map((entry) => ({
    ...(typeof entry.dataKey === "string" || typeof entry.dataKey === "number"
      ? { dataKey: entry.dataKey }
      : {}),
    ...(entry.name === undefined ? {} : { name: entry.name }),
    value: typeof entry.value === "number" || typeof entry.value === "string" ? entry.value : null,
    ...(entry.color === undefined ? {} : { color: entry.color }),
  }))
}

/** The tooltip recharts renders for a chart, in the library's tooltip surface. */
function Tip({ format, ...props }: TipProps & { readonly format?: (value: number) => string }) {
  return (
    <ChartTooltipContent
      {...(props.active === undefined ? {} : { active: props.active })}
      payload={itemsOf(props.payload)}
      {...(props.label === undefined ? {} : { label: props.label })}
      {...(format && { valueFormatter: (value: number | string) => format(Number(value)) })}
    />
  )
}

/**
 * A line across runs, oldest on the left, drawn by recharts in the library's chart container:
 * a pass rate, a run time, a cache hit rate. Missing values leave a gap.
 */
export function TrendLine({
  label,
  values,
  labels,
  range,
  color = "var(--danwo-colors-series-1)",
  height = "8rem",
  format = String,
  axis = true,
}: {
  readonly label: string
  readonly values: readonly TrendValue[]
  /** What each point is called in the tooltip: a run's time, a day. */
  readonly labels?: readonly string[]
  readonly range?: readonly [number, number]
  readonly color?: string
  readonly height?: string
  readonly format?: (value: number) => string
  /** Draw the value axis; a small chart in a card leaves it off. */
  readonly axis?: boolean
}) {
  const config: ChartConfig = { value: { label, color } }
  const points: TrendPoint[] = values.map((value, i) => ({
    at: labels?.[i] ?? String(i + 1),
    value,
  }))

  return (
    <Box role="img" aria-label={label} w="full">
      <ChartContainer config={config} h={height} w="full">
        <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="at" hide />
          <YAxis
            hide={!axis}
            width={44}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            tick={TICK}
            tickFormatter={(value: number) => format(value)}
            {...(range && { domain: [range[0], range[1]] })}
          />
          <ChartTooltip
            cursor={{ stroke: GRID }}
            content={(props: TipProps) => <Tip {...props} format={format} />}
          />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={1.75}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </Box>
  )
}

/** One bar of a stacked bar chart: its label and the count in each series. */
export interface StackedPoint {
  readonly label: string
  readonly [series: string]: string | number
}

/**
 * Stacked bars, one per point, drawn by recharts in the library's chart container; clicking a bar
 * hands its label back.
 */
export function StackedBars({
  label,
  points,
  series,
  height = "10rem",
  onPick,
}: {
  readonly label: string
  readonly points: readonly StackedPoint[]
  readonly series: readonly {
    readonly key: string
    readonly label: string
    readonly color: string
  }[]
  readonly height?: string
  readonly onPick?: (label: string) => void
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((each) => [each.key, { label: each.label, color: each.color }]),
  )
  const every = Math.max(1, Math.ceil(points.length / 7))

  return (
    <Box role="img" aria-label={label} w="full">
      <ChartContainer config={config} h={height} w="full">
        <BarChart
          data={[...points]}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
          onClick={(state: { activeLabel?: string | number }) => {
            if (onPick && state.activeLabel !== undefined) onPick(String(state.activeLabel))
          }}
        >
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={every - 1}
            tick={TICK}
          />
          <YAxis
            width={32}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            allowDecimals={false}
            tick={TICK}
          />
          <ChartTooltip
            cursor={{ fill: "var(--danwo-colors-surface-hover)" }}
            content={(props: TipProps) => <Tip {...props} />}
          />
          {series.map((each, i) => (
            <Bar
              key={each.key}
              dataKey={each.key}
              stackId="stack"
              fill={`var(--color-${each.key})`}
              radius={i === series.length - 1 ? [2, 2, 0, 0] : 0}
              cursor={onPick ? "pointer" : undefined}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </Box>
  )
}
