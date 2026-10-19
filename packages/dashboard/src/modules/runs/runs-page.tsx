import { HStack, styled } from "@danwo/ui/jsx"
import { useNavigate } from "@tanstack/react-router"

import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { useFilter } from "../../lib/list-keys.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { StopAll } from "../live/run-actions.tsx"
import type { RunFilter, RunKind, RunPage } from "./runs-data.ts"
import { Pager, RunsTable } from "./runs-table.tsx"
import { PAGE_SIZE, runText } from "./runs-values.ts"

const Select = styled("select", {
  base: {
    h: "8",
    px: "2.5",
    rounded: "lg",
    bg: "surface.hover",
    color: "ink.strong",
    fontSize: "1",
    cursor: "pointer",
    outline: "none",
    _focus: { boxShadow: "0 0 0 3px {colors.ring}" },
  },
})

/** One of the filter bar's dropdowns, kept in the page's address. */
function Choice({
  name,
  label,
  value,
  options,
}: {
  readonly name: "kind" | "status" | "days"
  readonly label: string
  readonly value: string | number | undefined
  readonly options: readonly (readonly [string, string])[]
}) {
  const navigate = useNavigate()

  return (
    <Select
      aria-label={label}
      value={value === undefined ? "" : String(value)}
      onChange={(event) => {
        const picked = event.target.value

        void navigate({
          to: "/runs",
          search: (prev) => ({
            ...prev,
            page: undefined,
            day: undefined,
            [name]: picked === "" ? undefined : name === "days" ? Number(picked) : picked,
          }),
          replace: true,
        })
      }}
    >
      {options.map(([key, word]) => (
        <option key={key} value={key}>
          {word}
        </option>
      ))}
    </Select>
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
    <HStack gap="2" flexWrap="wrap">
      <Choice
        name="status"
        label="Status"
        value={filter.status}
        options={[
          ["", "All statuses"],
          ["passed", "Passed"],
          ["failed", "Had a failure"],
        ]}
      />
      <Choice
        name="kind"
        label="Kind of run"
        value={filter.kind}
        options={[
          ["", "Test and matrix runs"],
          ["test", "Test runs"],
          ["matrix", "Matrix runs"],
        ]}
      />
      <Choice
        name="days"
        label="When"
        value={filter.days}
        options={[
          ["", day === undefined ? "All dates" : `On ${day}`],
          ["1", "Last 24 hours"],
          ["7", "Last 7 days"],
          ["30", "Last 30 days"],
        ]}
      />
    </HStack>
  )
}

/** What each kind of run is, said once. */
const KIND_HELP: Readonly<Record<RunKind | "both", string>> = {
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
      <HStack justify="space-between" gap="3" mb="3" flexWrap="wrap">
        <FilterBar filter={filter} day={filter.day} />
        <styled.span color="ink.muted" fontSize="1">
          {total} of {counts.test + counts.matrix} runs
        </styled.span>
      </HStack>
      {total === 0 ? (
        <Empty title="No runs match" hint="No run matches these filters." />
      ) : (
        <>
          <RunsTable shown={found.shown} deferred={found.deferred} box={found.box} />
          <Pager page={page} pages={Math.ceil(total / PAGE_SIZE)} />
        </>
      )}
    </Page>
  )
}
