/**
 * The bugs the benchmark app can be started with, one switch each in `BENCH_BUGS` (comma
 * separated). Three break what a user sees; five break how the app handles its providers, the
 * kind only faults behind the app expose.
 */
const UI_BUGS = ["wrong-total", "dead-second-click", "hidden-validation"] as const

export const PROVIDER_BUGS = [
  "no-dedupe",
  "no-idempotency",
  "fulfil-on-redirect",
  "no-verify",
  "raw-429",
] as const

export type Bug = (typeof UI_BUGS)[number] | (typeof PROVIDER_BUGS)[number]

const ALL: readonly string[] = [...UI_BUGS, ...PROVIDER_BUGS]

function isBug(name: string): name is Bug {
  return ALL.includes(name)
}

/** The bugs `BENCH_BUGS` turns on; unknown names are refused so a typo cannot pass as "no bug". */
export function bugsFrom(env: string | undefined): ReadonlySet<Bug> {
  const names = (env ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")

  for (const name of names) if (!isBug(name)) throw new Error(`unknown benchmark bug "${name}"`)

  return new Set(names.filter(isBug))
}
