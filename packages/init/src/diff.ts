/**
 * A line diff for showing what replacing a file would change: lines only in the old file start
 * with `-`, lines only in the new one with `+`, and runs of unchanged lines fold to a count.
 */

/** Unchanged lines kept around each change for context. */
const CONTEXT = 1

type Kind = " " | "-" | "+"
type Edit = { readonly kind: Kind; readonly line: string }

/** A table cell, 0 past its edges. */
function cell(table: readonly (readonly number[])[], i: number, j: number): number {
  return table[i]?.[j] ?? 0
}

/** The longest common subsequence table of `a` and `b`, from the end. */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )

  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]?.splice(
        j,
        1,
        a[i] === b[j]
          ? cell(table, i + 1, j + 1) + 1
          : Math.max(cell(table, i + 1, j), cell(table, i, j + 1)),
      )

  return table
}

/** The next edit at `a[i]` and `b[j]`: keep a shared line, else take the side the table favours. */
function nextKind(
  a: readonly string[],
  b: readonly string[],
  [i, j]: readonly [number, number],
  table: readonly (readonly number[])[],
): Kind {
  if (i < a.length && j < b.length && a[i] === b[j]) return " "
  if (i === a.length) return "+"
  if (j === b.length) return "-"

  return cell(table, i, j + 1) > cell(table, i + 1, j) ? "+" : "-"
}

/** The edits that turn `a` into `b`. */
function edits(a: readonly string[], b: readonly string[]): Edit[] {
  const table = lcsTable(a, b)
  const out: Edit[] = []
  let i = 0
  let j = 0

  while (i < a.length || j < b.length) {
    const kind = nextKind(a, b, [i, j], table)

    out.push({ kind, line: (kind === "+" ? b[j] : a[i]) ?? "" })
    if (kind !== "+") i++
    if (kind !== "-") j++
  }

  return out
}

/** Whether the edit at `index` is within `CONTEXT` lines of a change. */
function nearChange(all: readonly Edit[], index: number): boolean {
  return all
    .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
    .some((edit) => edit.kind !== " ")
}

/** `before` and `after` as a short line diff. */
export function lineDiff(before: string, after: string): string {
  const all = edits(before.trimEnd().split("\n"), after.trimEnd().split("\n"))
  const out: string[] = []
  let folded = 0

  all.forEach((edit, index) => {
    if (edit.kind === " " && !nearChange(all, index)) {
      folded++

      return
    }

    if (folded > 0) out.push(`  … ${folded} unchanged`)
    folded = 0
    out.push(`${edit.kind} ${edit.line}`)
  })
  if (folded > 0) out.push(`  … ${folded} unchanged`)

  return out.join("\n")
}
