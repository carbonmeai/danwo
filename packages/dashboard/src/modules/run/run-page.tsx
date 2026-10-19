import type { RunHistory } from "@danwo/runner/runner"
import { Link } from "@tanstack/react-router"

import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { MatrixRun, type MatrixView } from "../matrix/matrix-run.tsx"
import { TestRun } from "./test-run.tsx"

/** One run: a test run's tests, or a matrix run's faults, or a note that it is gone. */
export function RunPage({
  run,
  view,
}: {
  readonly run: RunHistory | null
  readonly view: MatrixView
}) {
  const runs = <Link to="/">Runs</Link>

  if (run === null)
    return (
      <Page crumbs={[runs, "Not found"]} title="No such run">
        <Empty
          title="No such run"
          hint={
            <>
              It may have been pruned; the history keeps the latest 200 runs.{" "}
              <Link to="/">See all runs</Link>
            </>
          }
        />
      </Page>
    )

  return run.kind === "test" ? (
    <TestRun run={run} crumbs={runs} />
  ) : (
    <MatrixRun run={run} view={view} crumbs={runs} />
  )
}
