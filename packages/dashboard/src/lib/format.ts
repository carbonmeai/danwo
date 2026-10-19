/** How the dashboard writes durations, money, rates and times. */

export function duration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`

  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1_000)} s`
}

export function dollars(usd: number): string {
  if (usd === 0) return "–"

  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

/** A 0–1 share as a whole percentage, or a dash when there is nothing to divide. */
export function percent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 100)}%`
}

export function when(iso: string): string {
  const date = new Date(iso)

  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

/** How long ago `iso` was, such as "3 minutes ago"; "just now" under a minute. */
export function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso)

  if (Number.isNaN(then)) return iso

  const elapsed = now - then
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

  for (const [unit, size] of UNITS)
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit)

  return "just now"
}
