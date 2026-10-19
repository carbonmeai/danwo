import { HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { ListFilter, SegmentTrack, segment } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { useFilter } from "../../lib/list-keys.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { MatrixIcon, TestIcon } from "./run-icons.tsx"
import type { RunKind, RunPage } from "./runs-data.ts"
import { RunsHealth } from "./runs-health.tsx"
import { Pager, RunsTable } from "./runs-table.tsx"
import { PAGE_SIZE, runText } from "./runs-values.ts"

/** What each kind of run is, said once, over its tab. */
const KIND_HELP: Readonly<Record<RunKind, string>> = {
  test: "Test runs: danwo test ran the picked tests once each, retrying a failure when retries are on.",
  matrix:
    "Matrix runs: danwo matrix recorded one clean run of a test, then replayed it once per planned fault, judged by its invariant.",
}

/** The two tabs: test runs and matrix runs, each with how many there are. */
function KindTabs({
  kind,
  counts,
}: {
  readonly kind: RunKind
  readonly counts: Readonly<Record<RunKind, number>>
}) {
  const tabs = [
    { kind: "test", label: "Test runs", icon: <TestIcon /> },
    { kind: "matrix", label: "Matrix runs", icon: <MatrixIcon /> },
  ] as const

  return (
    <SegmentTrack role="tablist" aria-label="Kind of run">
      {tabs.map((tab) => (
        <Link
          key={tab.kind}
          to="/runs"
          search={{ ...(tab.kind === "matrix" && { kind: "matrix" }) }}
          className={segment}
          role="tab"
          aria-selected={tab.kind === kind}
          data-on={tab.kind === kind || undefined}
          replace
        >
          <HStack gap="1.5">
            {tab.icon}
            {tab.label}
            <styled.span color="ink.faint">{counts[tab.kind]}</styled.span>
          </HStack>
        </Link>
      ))}
    </SegmentTrack>
  )
}

/**
 * Every run of `danwo test` or of `danwo matrix`, a tab each, newest first, under the project's
 * health, with the runs still going at the top.
 */
export function RunsPage({
  runs,
  kind,
  page,
  query,
}: {
  readonly runs: RunPage & { readonly counts: Readonly<Record<RunKind, number>> }
  readonly kind: RunKind
  readonly page: number
  /** The filter as the page's address holds it. */
  readonly query?: { readonly query: string; readonly onChange: (query: string) => void }
}) {
  const { rows, total, health, counts } = runs
  const filter = useFilter(rows, runText, query)

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
      detail="Every time danwo test or danwo matrix ran in this project, newest first"
      actions={<ListFilter label="Filter runs" placeholder="Filter runs" filter={filter} />}
    >
      <LiveRuns />
      {page === 0 ? <RunsHealth health={health} /> : null}
      <Stack gap="2" mt="6" mb="3">
        <KindTabs kind={kind} counts={counts} />
        <styled.p color="ink.muted" fontSize="1">
          {KIND_HELP[kind]}
        </styled.p>
      </Stack>
      {total === 0 ? (
        <Empty
          title={kind === "matrix" ? "No matrix runs yet" : "No test runs yet"}
          hint={KIND_HELP[kind]}
          command={kind === "matrix" ? "danwo matrix <test file>" : "danwo test"}
        />
      ) : (
        <>
          <RunsTable shown={filter.shown} deferred={filter.deferred} box={filter.box} />
          <Pager page={page} pages={Math.ceil(total / PAGE_SIZE)} />
        </>
      )}
    </Page>
  )
}
