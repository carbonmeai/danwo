/** A value on a sparkline, null where the run had nothing to plot. */
export type SparkValue = number | null

/** The polyline points for `values` in a `width` × `height` box, skipping missing values. */
export function sparkPoints(
  values: readonly SparkValue[],
  width: number,
  height: number,
  range?: readonly [number, number],
): string {
  const present = values.filter((value): value is number => value !== null)

  if (present.length === 0) return ""

  const [low, high] = range ?? [Math.min(...present), Math.max(...present)]
  const span = high - low || 1
  const step = values.length > 1 ? width / (values.length - 1) : 0

  return values
    .flatMap((value, i) =>
      value === null
        ? []
        : [`${(i * step).toFixed(1)},${(height - ((value - low) / span) * height).toFixed(1)}`],
    )
    .join(" ")
}

/** A small line of recent values, newest on the right, with the last value marked. */
export function Sparkline({
  values,
  label,
  color = "var(--danwo-colors-series-1)",
  range,
  width = 112,
  height = 28,
  fluid = false,
}: {
  readonly values: readonly SparkValue[]
  readonly label: string
  readonly color?: string
  readonly range?: readonly [number, number]
  readonly width?: number
  readonly height?: number
  /** Stretch to the container's width instead of drawing at `width`. */
  readonly fluid?: boolean
}) {
  const points = sparkPoints(values, width, height, range)
  const last = points.split(" ").at(-1)?.split(",")

  return (
    <svg
      style={{ overflow: "visible", display: "block" }}
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      role="img"
      aria-label={label}
    >
      <line
        x1="0"
        x2={width}
        y1={height}
        y2={height}
        stroke="var(--danwo-colors-hairline)"
        strokeWidth="1"
      />
      {points === "" ? null : (
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {!fluid && last?.length === 2 ? (
        <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
      ) : null}
    </svg>
  )
}
