import { HStack } from "@danwo/ui/jsx"
import { Span } from "@danwo/ui/primitives/typography"
import { useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { ANY, Choice } from "../../components/choice.tsx"
import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { useFilter } from "../../lib/list-keys.ts"
import { VERDICT_CHOICES } from "../../lib/whose.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { StopAll } from "../live/run-actions.tsx"
import type { RunFilter, RunKind, RunPage } from "./runs-data.ts"
import { Pager, RunsTable } from "./runs-table.tsx"
import { PAGE_SIZE, runText } from "./runs-values.ts"

/** One of the filter bar's dropdowns, kept in the page's address. */
function RunChoice({
  name,
  label,
  value,
  options,
}: {
  readonly name: "kind" | "status" | "days" | "verdict"
  readonly label: string
  readonly value: string | number | undefined
  readonly options: readonly (readonly [string, string])[]
}) {
  const navigate = useNavigate()

  return (
    <Choice
      label={label}
      value={value === undefined ? ANY : String(value)}
      options={options}
      onChange={(picked) =>
        void navigate({
          to: "/runs",
          search: (prev) => ({
            ...prev,
            page: undefined,
            day: undefined,
            [name]: picked === ANY ? undefined : name === "days" ? Number(picked) : picked,
          }),
          replace: true,
        })
      }
    />
  )
}

/** The filter bar: status, kind of run and when, beside the search box. */
function FilterBar({
  filter,
  day,
}: {
  readonly filter: RunFilter
  readonly day: string | undefined
}) {
  return (
    <>
      <RunChoice
        name="status"
        label="Status"
        value={filter.status}
        options={[
          [ANY, "All statuses"],
          ["passed", "Passed"],
          ["failed", "Had a failure"],
        ]}
      />
      <RunChoice
        name="verdict"
        label="Whose failure"
        value={filter.verdict}
        options={[[ANY, "Any failure"], ...VERDICT_CHOICES]}
      />
      <RunChoice
        name="kind"
        label="Kind of run"
        value={filter.kind}
        options={[
          [ANY, "Test and matrix runs"],
          ["test", "Test runs"],
          ["matrix", "Matrix runs"],
        ]}
      />
      <RunChoice
        name="days"
        label="When"
        value={filter.days}
        options={[
          [ANY, day === undefined ? "All dates" : `On ${day}`],
          ["1", "Last 24 hours"],
          ["7", "Last 7 days"],
          ["30", "Last 30 days"],
        ]}
      />
    </>
  )
}

/** The bar above the table: the filters on the left, how many runs match on the right. */
export function FilterRow({
  filters,
  count,
}: {
  readonly filters: ReactNode
  readonly count: ReactNode
}) {
  return (
    <HStack justify="space-between" gap="3" mb="3" flexWrap="wrap">
      <HStack gap="2" flexWrap="wrap">
        {filters}
      </HStack>
      <Span color="ink.muted" fontSize="1">
        {count}
      </Span>
    </HStack>
  )
}

/** What each kind of run is, said once. */
export const KIND_HELP: Readonly<Record<RunKind | "both", string>> = {
  both: "danwo test runs the picked tests once each; danwo matrix replays one test once per planned fault, judged by its invariant.",
  test: "danwo test ran the picked tests once each, retrying a failure when retries are on.",
  matrix:
    "danwo matrix recorded one clean run of a test, then replayed it once per planned fault, judged by its invariant.",
}

/**
 * Every run of `danwo test` and `danwo matrix` as one table, newest first, filtered by status, kind
 * and date, with the runs still going at the top and a way to stop them.
 */
export function RunsPage({
  runs,
  filter,
  page,
  query,
}: {
  readonly runs: RunPage & { readonly counts: Readonly<Record<RunKind, number>> }
  readonly filter: RunFilter
  readonly page: number
  /** The filter as the page's address holds it. */
  readonly query?: { readonly query: string; readonly onChange: (query: string) => void }
}) {
  const { rows, total, counts } = runs
  const found = useFilter(rows, runText, query)

  if (counts.test + counts.matrix === 0)
    return (
      <Page crumbs={["Runs"]} title="Runs">
        <LiveRuns />
        <Empty
          title="No runs yet"
          hint="Run your tests once and they show up here, with every recording they kept. A matrix run then breaks each provider call and webhook in turn."
          command="danwo test"
        />
      </Page>
    )

  return (
    <Page
      crumbs={["Runs"]}
      title="Runs"
      detail={KIND_HELP[filter.kind ?? "both"]}
      actions={
        <>
          <StopAll />
          <ListFilter label="Filter runs" placeholder="Search runs" filter={found} />
        </>
      }
    >
      <LiveRuns />
      <FilterRow
        filters={<FilterBar filter={filter} day={filter.day} />}
        count={`${total} of ${counts.test + counts.matrix} runs`}
      />
      {total === 0 ? (
        <Empty title="No runs match" hint="No run matches these filters." />
      ) : (
        <>
          <RunsTable
            shown={found.shown}
            deferred={found.deferred}
            box={found.box}
            keepRuns={runs.keepRuns}
          />
          <Pager page={page} pages={Math.ceil(total / PAGE_SIZE)} />
        </>
      )}
    </Page>
  )
}
