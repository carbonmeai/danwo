/**
 * What changed between two accessibility snapshots of a page, so an action's answer can show the
 * difference instead of the whole page again. Lines are compared without their refs (an element
 * can be given a new ref when the page re-renders); added lines keep theirs, since the agent acts
 * on them next.
 */

/** A diff larger than this answers with the whole page instead. */
const MAX_DIFF_LINES = 120

const REF = / \[ref=(?:f\d+)?e\d+\]/g

function keyOf(line: string): string {
  return line.replace(REF, "")
}

/** How many times each line (without refs) occurs. */
function counts(lines: readonly string[]): Map<string, number> {
  const seen = new Map<string, number>()

  for (const line of lines) seen.set(keyOf(line), (seen.get(keyOf(line)) ?? 0) + 1)

  return seen
}

/** The lines of `lines` that `other` has fewer of, in order. */
function surplus(lines: readonly string[], other: Map<string, number>): string[] {
  const left = new Map(other)

  return lines.filter((line) => {
    const key = keyOf(line)
    const remaining = left.get(key) ?? 0

    if (remaining > 0) {
      left.set(key, remaining - 1)

      return false
    }

    return true
  })
}

export type SnapshotChange =
  | { readonly kind: "same" }
  | { readonly kind: "diff"; readonly lines: readonly string[] }
  | { readonly kind: "whole" }

/** The change from `before` to `after`: nothing, `+`/`-` lines, or too much to show as a diff. */
export function snapshotChange(before: string, after: string): SnapshotChange {
  const old = before.split("\n").filter((line) => line.trim() !== "")
  const now = after.split("\n").filter((line) => line.trim() !== "")
  const removed = surplus(old, counts(now)).map((line) => `- ${line.trim()}`)
  const added = surplus(now, counts(old)).map((line) => `+ ${line.trim()}`)
  const lines = [...removed, ...added]

  if (lines.length === 0) return { kind: "same" }

  return lines.length > MAX_DIFF_LINES || lines.length > now.length
    ? { kind: "whole" }
    : { kind: "diff", lines }
}
