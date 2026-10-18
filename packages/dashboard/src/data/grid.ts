/**
 * A matrix run laid out as a grid: one row per thing a fault landed on (a provider route, a
 * webhook, a race), one column per kind of fault, each cell one trial's verdict.
 */
import type { HistoryTrial } from "@danwo/runner/runner"

/** One trial placed in the grid. */
export interface GridCell {
  readonly row: string
  readonly column: string
  readonly trial: HistoryTrial
}

/** A row of the grid: what the faults landed on, and whether it is a call, a webhook or a race. */
export interface GridRow {
  readonly target: string
  readonly kind: "call" | "webhook" | "race"
}

export interface FaultGrid {
  readonly rows: readonly GridRow[]
  readonly columns: readonly string[]
  readonly cells: readonly GridCell[]
}

/** The order fault kinds read in, left to right; kinds not listed follow in the order they appear. */
const COLUMN_ORDER = [
  "status 500",
  "status 502",
  "status 503",
  "status 429",
  "status 4xx",
  "reset",
  "reset-after",
  "delay",
  "pending",
  "duplicate",
  "forged",
  "stale",
  "double-submit",
  "slow-then-retry",
  "before redirect",
  "reorder",
  "concurrent users",
]

/** A fault kind as a column names it: delays and stale times drop their numbers. */
function columnOf(kind: string): string {
  if (/^delay\b/.test(kind)) return "delay"
  if (/^stale\b/.test(kind)) return "stale"
  if (/^slow-then-retry\b/.test(kind)) return "slow-then-retry"
  if (/^status 4\d\d$/.test(kind) && kind !== "status 429") return "status 4xx"

  return kind
}

/** Splits a trial's label into its fault kind and what it landed on. */
export function placeOf(label: string): { readonly column: string; readonly row: GridRow } {
  const reorder = /^reorder (?:(\S+) )?webhooks (.+)$/.exec(label)

  if (reorder) return { column: "reorder", row: { target: reorder[2] ?? label, kind: "race" } }

  const users = /^(\d+) concurrent users$/.exec(label)

  if (users) return { column: "concurrent users", row: { target: "the whole test", kind: "race" } }

  const redirect = /^webhooks before redirect from (.+)$/.exec(label)

  if (redirect)
    return { column: "before redirect", row: { target: redirect[1] ?? label, kind: "race" } }

  const at = label.indexOf(" on ")

  if (at < 0) return { column: label, row: { target: "–", kind: "race" } }

  const kind = label.slice(0, at)
  const target = label.slice(at + 4)
  const webhook = /\bwebhook /.test(target)

  return {
    column: columnOf(kind),
    row: {
      target: webhook ? target.replace(/^(?:(\S+) )?webhook /, "$1 ").trim() : target,
      kind: webhook ? "webhook" : kind === "double-submit" ? "race" : "call",
    },
  }
}

function columnRank(column: string): number {
  const index = COLUMN_ORDER.indexOf(column)

  return index < 0 ? COLUMN_ORDER.length : index
}

/** The trials of a matrix run as a grid, rows in the order the run first reached them. */
export function faultGrid(trials: readonly HistoryTrial[]): FaultGrid {
  const rows = new Map<string, GridRow>()
  const columns = new Set<string>()
  const cells: GridCell[] = []

  for (const trial of trials) {
    if (trial.fault === null) continue

    const { column, row } = placeOf(trial.fault)

    if (!rows.has(row.target)) rows.set(row.target, row)
    columns.add(column)
    cells.push({ row: row.target, column, trial })
  }

  return {
    rows: [...rows.values()],
    columns: [...columns].toSorted((a, b) => columnRank(a) - columnRank(b)),
    cells,
  }
}
