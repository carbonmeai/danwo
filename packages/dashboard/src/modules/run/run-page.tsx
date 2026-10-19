import type { RunHistory } from "@danwo/runner/runner"
import { Link } from "@tanstack/react-router"

import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { LiveRunPage } from "../live/live-run-page.tsx"
import type { LiveView } from "../live/live-values.ts"
import { MatrixRun, type MatrixView } from "../matrix/matrix-run.tsx"
import { TestRun } from "./test-run.tsx"

/** Where in a run its address points: a test of a test run, a trial of a matrix run. */
export interface RunFocus {
  readonly test?: string
  readonly trial?: string
}

/**
 * One run: a test run's tests, or a matrix run's faults; a run still going as it happens; or a
 * note that it is gone.
 */
export function RunPage({
  run,
  live,
  view,
  search,
}: {
  readonly run: RunHistory | null
  readonly live: LiveView | null
  readonly view: MatrixView
  readonly search: RunFocus
}) {
  const runs = <Link to="/">Runs</Link>

  if (run === null && live !== null) return <LiveRunPage key={live.id} initial={live} />

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
    <TestRun run={run} crumbs={runs} focus={search.test} />
  ) : (
    <MatrixRun run={run} view={view} crumbs={runs} focus={search.trial} />
  )
}
