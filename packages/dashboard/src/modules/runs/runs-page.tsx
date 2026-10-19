import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { useFilter } from "../../lib/list-keys.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import type { RunPage } from "./runs-data.ts"
import { RunsHealth } from "./runs-health.tsx"
import { Pager, RunsTable } from "./runs-table.tsx"
import { PAGE_SIZE, runText } from "./runs-values.ts"

/**
 * Every run of `danwo test` and `danwo matrix`, newest first, under the project's health, with the
 * runs still going at the top.
 */
export function RunsPage({
  runs,
  page,
  query,
}: {
  readonly runs: RunPage
  readonly page: number
  /** The filter as the page's address holds it. */
  readonly query?: { readonly query: string; readonly onChange: (query: string) => void }
}) {
  const { rows, total, health } = runs
  const filter = useFilter(rows, runText, query)

  if (total === 0)
    return (
      <Page crumbs={["Runs"]} title="Runs">
        <LiveRuns />
        <Empty
          title="No runs yet"
          hint="Run your tests once and they show up here, with every flight record they kept. A matrix run then breaks each provider route and webhook in turn."
          command="danwo test"
        />
      </Page>
    )

  return (
    <Page
      crumbs={["Runs"]}
      title="Runs"
      detail={`${total} ${total === 1 ? "run" : "runs"} of danwo test and danwo matrix, newest first`}
      actions={<ListFilter label="Filter runs" placeholder="Filter runs" filter={filter} />}
    >
      <LiveRuns />
      {page === 0 ? <RunsHealth health={health} /> : null}
      <RunsTable shown={filter.shown} deferred={filter.deferred} box={filter.box} />
      <Pager page={page} pages={Math.ceil(total / PAGE_SIZE)} />
    </Page>
  )
}
