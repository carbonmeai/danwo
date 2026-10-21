import { useEffect } from "react"

/** What a page already showed of a run: its kind, its title and how many of it failed. */
export interface KnownRun {
  readonly id: string
  readonly kind: "test" | "matrix"
  readonly title: string
  readonly failed: number
}

/** A run as a list shows it: the overview with its failures, the runs list with every count. */
type ListedRun = Omit<KnownRun, "failed"> &
  ({ readonly failed: number } | { readonly counts: { readonly failed: number } })

/** The runs this tab has listed, by id, so a run opening from a list loads in its own shape. */
const known = new Map<string, KnownRun>()

/** Remembers the runs a page lists, for as long as the tab stays open. */
export function useKnownRuns(runs: readonly ListedRun[]): void {
  useEffect(() => {
    for (const run of runs)
      known.set(run.id, {
        id: run.id,
        kind: run.kind,
        title: run.title,
        failed: "failed" in run ? run.failed : run.counts.failed,
      })
  }, [runs])
}

/** A run a page in this tab listed, if one did. */
export const knownRun = (id: string): KnownRun | undefined => known.get(id)
