/** How the dashboard writes durations, money and times. */

export function duration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`

  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1_000)} s`
}

export function dollars(usd: number): string {
  if (usd === 0) return "–"

  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function when(iso: string): string {
  const date = new Date(iso)

  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
