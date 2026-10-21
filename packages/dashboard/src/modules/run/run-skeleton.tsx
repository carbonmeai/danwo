import { Link } from "@tanstack/react-router"

import { type MatrixView, MatrixRunSkeleton } from "../matrix/matrix-run.tsx"
import { knownRun } from "./known-runs.ts"
import { TestRunSkeleton } from "./test-run.tsx"

/**
 * A run while it loads. A run mostly opens from the runs list or the overview, which already
 * said its kind and title, so it loads as a matrix run's skeleton when it is one, and as a test
 * run's otherwise, which a run still going looks like too.
 */
export function RunSkeleton({
  runId,
  view,
}: {
  readonly runId: string
  readonly view: MatrixView
}) {
  const known = knownRun(runId)
  const runs = (
    <Link to="/runs" search={known?.kind === "matrix" ? { kind: "matrix" } : {}}>
      Runs
    </Link>
  )

  return known?.kind === "matrix" ? (
    <MatrixRunSkeleton runId={runId} view={view} crumbs={runs} title={known.title} />
  ) : (
    <TestRunSkeleton crumbs={runs} title={known?.title} failed={known?.failed ?? 0} />
  )
}
