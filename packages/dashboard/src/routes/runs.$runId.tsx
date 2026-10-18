import type {
  HistoryTest,
  HistoryTrial,
  MatrixHistory,
  TestHistory,
  Usage,
} from "@danwo/runner/runner"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { type ColumnDef, DataGrid } from "@danwo/ui/primitives/data-grid"
import { createFileRoute, Link } from "@tanstack/react-router"

import { fetchRun } from "../api.ts"
import { dollars, duration, when } from "../components/format.ts"
import { Code, Empty, PageTitle, StatusBadge } from "../components/status.tsx"

export const Route = createFileRoute("/runs/$runId")({
  loader: ({ params }) => fetchRun({ data: params.runId }),
  component: RunPage,
})

/** A cache summary such as `3 replayed · 1 relocated`. */
function cacheLine(usages: readonly (Usage | undefined)[]): string {
  const totals = new Map<string, number>()

  for (const usage of usages)
    for (const [outcome, n] of Object.entries(usage?.cache ?? {}))
      totals.set(outcome, (totals.get(outcome) ?? 0) + (n ?? 0))

  return [...totals].map(([outcome, n]) => `${n} ${outcome}`).join(" · ") || "–"
}

/** Links to a test's kept flight records, one per attempt that kept one. */
function AttemptLinks({ test }: { readonly test: HistoryTest }) {
  const kept = test.attempts.flatMap((attempt, i) =>
    attempt.record ? [{ i, dir: attempt.record }] : [],
  )

  if (kept.length === 0) return <span>–</span>

  return (
    <HStack gap="2">
      {kept.map(({ i, dir }) => (
        <Link key={dir} to="/records/$" params={{ _splat: dir }}>
          attempt {i + 1}
        </Link>
      ))}
    </HStack>
  )
}

const testColumns: ColumnDef<HistoryTest>[] = [
  { header: "Test", accessorKey: "id" },
  {
    header: "Status",
    accessorKey: "status",
    size: 110,
    cell: (c) => <StatusBadge status={c.row.original.status} />,
  },
  { header: "Attempts", id: "attempts", size: 90, accessorFn: (t) => t.attempts.length },
  {
    header: "Error",
    id: "error",
    enableSorting: false,
    cell: (c) => c.row.original.attempts.find((a) => a.error)?.error?.message ?? "",
  },
  {
    header: "Cache",
    id: "cache",
    enableSorting: false,
    size: 200,
    cell: (c) => cacheLine(c.row.original.attempts.map((a) => a.usage)),
  },
  {
    header: "Records",
    id: "records",
    enableSorting: false,
    size: 170,
    cell: (c) => <AttemptLinks test={c.row.original} />,
  },
]

function TestRun({ run }: { readonly run: TestHistory }) {
  return (
    <>
      <PageTitle
        title={`danwo test · ${run.tests.length} tests`}
        detail={`${when(run.startedAt)} · ${duration(run.durationMs)} · ${run.usage.spent.calls} model calls · ${dollars(run.usage.spent.usd)} · cache ${cacheLine([run.usage])}`}
      />
      {run.brokenFiles.length > 0 ? (
        <Stack mb="4" gap="1" color="brand.error.11" fontSize="1">
          {run.brokenFiles.map((broken) => (
            <span key={broken.file}>
              {broken.file}: {broken.error}
            </span>
          ))}
        </Stack>
      ) : null}
      <DataGrid
        data={run.tests}
        columns={testColumns}
        getRowId={(t) => t.id}
        initialSorting={[{ id: "status", desc: false }]}
        height="70vh"
      />
    </>
  )
}

/** The words a trial status reads as in the grid's legend. */
const TRIAL_ORDER = ["failed", "not-judged", "invalid", "environment-error", "passed"]

function TrialCell({ trial }: { readonly trial: HistoryTrial }) {
  const body = (
    <Stack
      gap="1"
      p="3"
      h="full"
      rounded="md"
      borderWidth="1px"
      borderColor="border.subtle"
      data-trial={trial.fault ?? "clean run"}
      data-status={trial.status}
    >
      <HStack justify="space-between" gap="2">
        <styled.span fontSize="1" fontWeight="medium" overflow="hidden" textOverflow="ellipsis">
          {trial.fault ?? "clean run"}
        </styled.span>
        <StatusBadge status={trial.status} />
      </HStack>
      {trial.error ? (
        <Box color="text.secondary" fontSize="0.5" lineClamp="2">
          {trial.error}
        </Box>
      ) : null}
      <Box color="text.secondary" fontSize="0.5">
        {trial.calls} calls · {trial.deliveries} deliveries
      </Box>
    </Stack>
  )

  return trial.record ? (
    <Link to="/records/$" params={{ _splat: trial.record }}>
      {body}
    </Link>
  ) : (
    body
  )
}

function MatrixRun({ run }: { readonly run: MatrixHistory }) {
  const trials = run.trials.toSorted(
    (a, b) => TRIAL_ORDER.indexOf(a.status) - TRIAL_ORDER.indexOf(b.status),
  )
  const count = (status: string) => run.trials.filter((t) => t.status === status).length

  return (
    <>
      <PageTitle
        title={`danwo matrix · ${run.testId}`}
        detail={`${when(run.startedAt)} · ${duration(run.durationMs)} · ${count("passed")} passed · ${count("failed")} failed · ${count("not-judged")} not judged · ${count("invalid")} invalid`}
      />
      <Box mb="4" maxW="24rem">
        <TrialCell trial={run.clean} />
      </Box>
      {trials.length === 0 ? (
        <Empty title="No faults ran" hint="Faults only run once the clean run passes." />
      ) : (
        <Grid
          role="list"
          aria-label="Faults"
          gridTemplateColumns="repeat(auto-fill, minmax(16rem, 1fr))"
          gap="3"
        >
          {trials.map((trial) => (
            <Box role="listitem" key={trial.fault}>
              <TrialCell trial={trial} />
            </Box>
          ))}
        </Grid>
      )}
    </>
  )
}

function RunPage() {
  const run = Route.useLoaderData()

  if (run === null)
    return (
      <Empty
        title="No such run"
        hint={
          <>
            It may have been pruned; the history keeps the latest 200. <Link to="/">All runs</Link>
          </>
        }
      />
    )

  return run.kind === "test" ? (
    <TestRun run={run} />
  ) : (
    <>
      <MatrixRun run={run} />
      <Box mt="6" color="text.secondary" fontSize="1">
        Rerun with <Code>danwo matrix {run.file}</Code>
      </Box>
    </>
  )
}
