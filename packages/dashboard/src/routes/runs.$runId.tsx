import type {
  HistoryTest,
  HistoryTrial,
  MatrixHistory,
  TestHistory,
  Usage,
} from "@danwo/runner/runner"
import { css } from "@danwo/ui/css"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Fragment, useRef, useState } from "react"

import { fetchRun } from "../api.ts"
import { BarList } from "../components/bars.tsx"
import { ago, dollars, duration, percent, when } from "../components/format.ts"
import { useListKeys } from "../components/keys.ts"
import {
  Command,
  Empty,
  Facts,
  Ident,
  KeyHint,
  LintLabel,
  PageTitle,
  Panel,
  Section,
  type Share,
  StatusBadge,
  Swatch,
  toneOf,
  VerdictStrip,
  wordOf,
} from "../components/status.tsx"
import { faultGrid, type GridCell, gridGroups } from "../data/grid.ts"
import { cacheHitRate } from "../data/trend.ts"

type View = "grid" | "list"

export const Route = createFileRoute("/runs/$runId")({
  validateSearch: (search: Record<string, unknown>): { view?: View } =>
    search.view === "list" ? { view: "list" } : {},
  loader: ({ params }) => fetchRun({ data: params.runId }),
  component: RunPage,
})

/** A cache summary such as `3 replayed, 1 relocated`. */
function cacheLine(usages: readonly (Usage | undefined)[]): string {
  const totals = new Map<string, number>()

  for (const usage of usages)
    for (const [outcome, n] of Object.entries(usage?.cache ?? {}))
      totals.set(outcome, (totals.get(outcome) ?? 0) + (n ?? 0))

  return [...totals].map(([outcome, n]) => `${n} ${outcome}`).join(", ") || "–"
}

function Started({ at }: { readonly at: string }) {
  return (
    <time dateTime={at} title={when(at)} suppressHydrationWarning>
      {ago(at)}
    </time>
  )
}

/** Links to a test's kept flight records, one per attempt that kept one. */
function AttemptLinks({ test }: { readonly test: HistoryTest }) {
  const kept = test.attempts.flatMap((attempt, i) =>
    attempt.record ? [{ i, dir: attempt.record }] : [],
  )

  if (kept.length === 0) return <styled.span color="signal.faint">–</styled.span>

  return (
    <HStack gap="3">
      {kept.map(({ i, dir }) => (
        <Link key={dir} to="/records/$" params={{ _splat: dir }}>
          attempt {i + 1}
        </Link>
      ))}
    </HStack>
  )
}

const ORDER = [
  "failed",
  "timed-out",
  "interrupted",
  "environment-error",
  "flaky",
  "passed",
  "skipped",
]

const Th = styled("th", {
  base: {
    textAlign: "left",
    fontWeight: "500",
    color: "signal.quiet",
    px: "4",
    py: "2.5",
    borderBottomWidth: "1px",
    borderColor: "signal.rule",
    whiteSpace: "nowrap",
  },
})

const Td = styled("td", {
  base: {
    px: "4",
    py: "3",
    borderBottomWidth: "1px",
    borderColor: "signal.rule",
    verticalAlign: "top",
  },
})

function TestRun({ run }: { readonly run: TestHistory }) {
  const tests = run.tests.toSorted((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
  const count = (status: string) => run.tests.filter((t) => t.status === status).length
  const list = useRef<HTMLTableSectionElement>(null)
  const current = useListKeys(list, tests.length)
  const shares: Share[] = [
    { tone: "passed", count: count("passed"), label: "passed" },
    { tone: "flaky", count: count("flaky"), label: "flaky" },
    {
      tone: "failed",
      count: tests.filter((t) => toneOf(t.status) === "failed").length,
      label: "failed",
    },
    { tone: "invalid", count: count("skipped"), label: "skipped" },
  ]

  return (
    <>
      <PageTitle
        title={`${run.tests.length} ${run.tests.length === 1 ? "test" : "tests"}`}
        detail={
          <>
            <Ident>danwo test</Ident> run, started <Started at={run.startedAt} />
          </>
        }
        actions={<KeyHint />}
      />
      <Facts
        items={[
          ["Result", <VerdictStrip key="strip" shares={shares} width="10rem" />],
          ["Passed", count("passed")],
          ["Failed", shares[2]?.count ?? 0],
          ["Flaky", count("flaky")],
          ["Time", duration(run.durationMs)],
          ["Model calls", run.usage.spent.calls],
          ["Spend", dollars(run.usage.spent.usd)],
          ["Replay cache", percent(cacheHitRate(run.usage))],
        ]}
      />
      {run.brokenFiles.length > 0 ? (
        <Panel p="4" mb="6" borderColor="verdict.failed.solid" aria-label="Files that did not load">
          <styled.p fontWeight="600" color="verdict.failed.fg" mb="2">
            {run.brokenFiles.length} test {run.brokenFiles.length === 1 ? "file" : "files"} did not
            load
          </styled.p>
          <Stack gap="1" fontSize="1.5">
            {run.brokenFiles.map((broken) => (
              <span key={broken.file}>
                <Ident>{broken.file}</Ident>: {broken.error}
              </span>
            ))}
          </Stack>
        </Panel>
      ) : null}
      <Panel overflow="hidden">
        <styled.table w="full" borderCollapse="collapse" fontSize="1.5">
          <thead>
            <tr>
              <Th w="8rem">Result</Th>
              <Th>Test</Th>
              <Th display={{ base: "none", lg: "table-cell" }}>Replay cache</Th>
              <Th textAlign="right">Time</Th>
              <Th>Flight records</Th>
            </tr>
          </thead>
          <tbody ref={list}>
            {tests.map((test, i) => {
              const error = test.attempts.find((a) => a.error)?.error
              const time = test.attempts.reduce((sum, a) => sum + a.durationMs, 0)

              return (
                <styled.tr
                  key={test.id}
                  data-row
                  data-current={i === current || undefined}
                  css={{
                    "&[data-current]": { bg: "signal.accentSoft" },
                    "&:last-child td": { borderBottomWidth: "0" },
                  }}
                >
                  <Td>
                    <StatusBadge status={test.status} />
                  </Td>
                  <Td>
                    <Stack gap="1">
                      <styled.span fontWeight="500" overflowWrap="anywhere">
                        {test.id}
                      </styled.span>
                      {error ? (
                        <styled.span color="verdict.failed.fg" fontSize="1" lineClamp="2">
                          <Ident>{error.code}</Ident> {error.message}
                        </styled.span>
                      ) : null}
                      {test.attempts.length > 1 ? (
                        <styled.span color="signal.quiet" fontSize="1">
                          {test.attempts.length} attempts
                        </styled.span>
                      ) : null}
                    </Stack>
                  </Td>
                  <Td color="signal.quiet" display={{ base: "none", lg: "table-cell" }}>
                    {cacheLine(test.attempts.map((a) => a.usage))}
                  </Td>
                  <Td textAlign="right" color="signal.quiet">
                    {duration(time)}
                  </Td>
                  <Td>
                    <AttemptLinks test={test} />
                  </Td>
                </styled.tr>
              )
            })}
          </tbody>
        </styled.table>
      </Panel>
    </>
  )
}

/** What each verdict means in a matrix, as the legend explains it. */
const LEGEND: readonly [string, string][] = [
  ["passed", "held under the fault"],
  ["failed", "the fault broke it"],
  ["not-judged", "could not be judged"],
  ["invalid", "the fault never applied"],
]

function Legend() {
  return (
    <HStack as="ul" aria-label="Legend" gap="5" flexWrap="wrap" fontSize="1.5" color="signal.quiet">
      {LEGEND.map(([status, meaning]) => (
        <HStack as="li" key={status} gap="2">
          <Swatch tone={toneOf(status)} w="3" h="3" />
          <span>
            <styled.span color="signal.ink" fontWeight="500">
              {wordOf(status)}
            </styled.span>{" "}
            {meaning}
          </span>
        </HStack>
      ))}
    </HStack>
  )
}

/** What the matrix asks of the app, and how much of it held. */
function Invariant({ run }: { readonly run: MatrixHistory }) {
  const held = run.trials.filter((t) => t.status === "passed").length
  const broke = run.trials.filter((t) => toneOf(t.status) === "failed").length
  const judged = run.trials.filter(
    (t) => t.status === "passed" || toneOf(t.status) === "failed",
  ).length
  const rule =
    run.judgedBy === "invariant"
      ? "The test's invariant must hold after every fault. Each faulted run stops at its first breaking step, then the invariant reads what the app left in the providers."
      : run.judgedBy === "body"
        ? "The test must pass with every fault in place. Add an invariant with test(…).invariant(fn) to judge what the app left behind instead."
        : "Each faulted run is judged the same way as the clean run."

  return (
    <Panel
      as="section"
      aria-label="Invariant"
      mb="8"
      p="6"
      borderLeftWidth="4px"
      borderLeftColor={broke > 0 ? "verdict.failed.solid" : "verdict.passed.solid"}
    >
      <Grid gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }} gap="8">
        <Stack gap="3">
          <Box color="signal.quiet" fontSize="1.5">
            {run.judgedBy === "invariant" ? "Invariant" : "What must hold"}
          </Box>
          <styled.p fontSize="4" fontWeight="500" lineHeight="1.4" maxW="44rem">
            {rule}
          </styled.p>
          <HStack gap="2" fontSize="1.5" color="signal.quiet" flexWrap="wrap">
            <span>The clean run, with no fault:</span>
            <StatusBadge status={run.clean.status} />
            {run.clean.record ? (
              <Link to="/records/$" params={{ _splat: run.clean.record }}>
                Open its flight record
              </Link>
            ) : null}
          </HStack>
        </Stack>
        <Stack gap="3" justify="center">
          <styled.p fontSize="7" fontWeight="500" letterSpacing="-0.02em" lineHeight="1.1">
            {broke > 0
              ? `Broke under ${broke} of ${run.trials.length}`
              : `Held under ${held} of ${run.trials.length}`}
            <styled.span color="signal.quiet" fontSize="4" fontWeight="400" ml="2">
              {run.trials.length === 1 ? "fault" : "faults"}
            </styled.span>
          </styled.p>
          <VerdictStrip
            width="100%"
            shares={[
              { tone: "passed", count: held, label: "passed" },
              { tone: "failed", count: broke, label: "failed" },
              {
                tone: "notJudged",
                count: run.trials.filter((t) => t.status === "not-judged").length,
                label: "not judged",
              },
              {
                tone: "invalid",
                count:
                  run.trials.length -
                  judged -
                  run.trials.filter((t) => t.status === "not-judged").length,
                label: "invalid",
              },
            ]}
          />
        </Stack>
      </Grid>
    </Panel>
  )
}

/** One trial in full: the fault, its verdict, what went wrong and where its record is. */
function TrialDetail({ trial }: { readonly trial: HistoryTrial | undefined }) {
  if (trial === undefined)
    return (
      <Box color="signal.quiet" fontSize="1.5">
        Point at a cell to see its trial.
      </Box>
    )

  return (
    <Stack gap="3" data-detail={trial.fault ?? "clean run"}>
      <StatusBadge status={trial.status} />
      <Ident fontSize="2" fontWeight="500" color="signal.ink">
        {trial.fault ?? "clean run"}
      </Ident>
      {trial.error ? (
        <Box fontSize="1.5" color="verdict.failed.fg" overflowWrap="anywhere">
          {trial.error}
        </Box>
      ) : null}
      {trial.notes.map((note) => (
        <Box key={note} fontSize="1.5" color="signal.quiet">
          {note}
        </Box>
      ))}
      <Box fontSize="1.5" color="signal.quiet">
        {trial.calls} provider {trial.calls === 1 ? "call" : "calls"}, {trial.deliveries}{" "}
        {trial.deliveries === 1 ? "webhook" : "webhooks"} delivered
      </Box>
      {trial.source ? (
        <Box fontSize="1.5" color="signal.quiet">
          Stopped at <Ident>{`${trial.source.file}:${trial.source.line}`}</Ident>
        </Box>
      ) : null}
      {trial.record ? (
        <Link to="/records/$" params={{ _splat: trial.record }}>
          Open the flight record
        </Link>
      ) : (
        <Box fontSize="1.5" color="signal.faint">
          No flight record was kept for this trial.
        </Box>
      )}
    </Stack>
  )
}

const CELL = "2.75rem"

const CellButton = styled("button", {
  base: {
    flex: "1",
    minW: "0",
    h: "full",
    cursor: "pointer",
    transition: "transform 120ms, box-shadow 120ms",
    _hover: { boxShadow: "0 0 0 2px {colors.signal.ink}" },
    _focusVisible: { outline: "2px solid {colors.signal.focus}", outlineOffset: "2px" },
    "&[data-picked]": { boxShadow: "0 0 0 2px {colors.signal.ink}" },
  },
  variants: {
    tone: {
      passed: { bg: "verdict.passed.solid" },
      failed: { bg: "verdict.failed.solid" },
      flaky: { bg: "verdict.flaky.solid" },
      notJudged: { bg: "verdict.notJudged.solid" },
      invalid: { bg: "verdict.invalid.solid" },
    },
  },
})

/** A cell of the heatmap: one coloured block per trial that landed there. */
function Cell({
  cells,
  picked,
  onPick,
}: {
  readonly cells: readonly GridCell[]
  readonly picked: HistoryTrial | undefined
  readonly onPick: (trial: HistoryTrial) => void
}) {
  const navigate = Route.useNavigate()

  if (cells.length === 0)
    return (
      <Box
        w={CELL}
        h={CELL}
        rounded="md"
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="signal.rule"
        aria-hidden="true"
      />
    )

  return (
    <HStack gap="0.5" w={CELL} h={CELL} role="group">
      {cells.map(({ trial }) => (
        <CellButton
          key={trial.fault}
          type="button"
          rounded="md"
          tone={toneOf(trial.status)}
          data-status={trial.status}
          data-picked={trial === picked || undefined}
          aria-label={`${trial.fault ?? "clean run"}: ${wordOf(trial.status)}`}
          title={`${trial.fault ?? "clean run"}: ${wordOf(trial.status)}`}
          onMouseEnter={() => onPick(trial)}
          onFocus={() => onPick(trial)}
          onClick={() => {
            if (trial.record) void navigate({ to: "/records/$", params: { _splat: trial.record } })
            else onPick(trial)
          }}
        />
      ))}
    </HStack>
  )
}

/** The trials as a heatmap: what a fault landed on down the side, the kind of fault across. */
function Heatmap({ run }: { readonly run: MatrixHistory }) {
  const grid = faultGrid(run.trials)
  const groups = gridGroups(grid)
  const [picked, setPicked] = useState<HistoryTrial | undefined>(
    () => run.trials.find((t) => toneOf(t.status) === "failed") ?? run.trials[0],
  )
  const at = (row: string, column: string) =>
    grid.cells.filter((cell) => cell.row === row && cell.column === column)

  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", xl: "minmax(0, 1fr) 20rem" }}
      gap="6"
      alignItems="start"
    >
      <Panel p="5" overflowX="auto">
        <Box
          display="grid"
          role="table"
          aria-label="Fault grid"
          style={{
            gridTemplateColumns: `minmax(10rem, 1fr) repeat(${grid.columns.length}, ${CELL})`,
          }}
          columnGap="1.5"
          rowGap="1.5"
          alignItems="center"
        >
          <Box role="row" display="contents">
            <Box role="columnheader" />
            {grid.columns.map((column) => (
              <Box
                key={column}
                role="columnheader"
                h="7rem"
                display="flex"
                alignItems="flex-end"
                justifyContent="center"
                pb="2"
              >
                <styled.span
                  fontSize="1"
                  color="signal.quiet"
                  whiteSpace="nowrap"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {column}
                </styled.span>
              </Box>
            ))}
          </Box>
          {groups.map((group) => (
            <Fragment key={group.kind}>
              <Box role="row" display="contents">
                <Box
                  role="rowheader"
                  gridColumn="1 / -1"
                  fontSize="1"
                  fontWeight="500"
                  color="signal.quiet"
                  pt="3"
                  pb="1"
                  borderBottomWidth="1px"
                  borderColor="signal.rule"
                >
                  {group.title}
                </Box>
              </Box>
              {group.rows.map((row) => (
                <Box role="row" display="contents" key={row.target}>
                  <Box role="rowheader" pr="4" minW="0">
                    <Ident
                      fontSize="1.5"
                      title={row.target}
                      display="block"
                      whiteSpace="nowrap"
                      overflow="hidden"
                      textOverflow="ellipsis"
                    >
                      {row.target}
                    </Ident>
                  </Box>
                  {grid.columns.map((column) => (
                    <Box role="cell" key={column}>
                      <Cell cells={at(row.target, column)} picked={picked} onPick={setPicked} />
                    </Box>
                  ))}
                </Box>
              ))}
            </Fragment>
          ))}
        </Box>
      </Panel>
      <Panel p="5" position={{ xl: "sticky" }} top="20" aria-live="polite" aria-label="Trial">
        <TrialDetail trial={picked} />
      </Panel>
    </Grid>
  )
}

/** The trials as a list, failures first, each with what went wrong. */
function TrialList({ run }: { readonly run: MatrixHistory }) {
  const order = ["failed", "environment-error", "not-judged", "invalid", "passed"]
  const trials = run.trials.toSorted((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  const list = useRef<HTMLUListElement>(null)
  const current = useListKeys(list, trials.length)

  return (
    <Panel overflow="hidden">
      <styled.ul ref={list} aria-label="Faults">
        {trials.map((trial, i) => (
          <styled.li
            key={trial.fault}
            data-row
            data-trial={trial.fault}
            data-status={trial.status}
            data-current={i === current || undefined}
            display="grid"
            gridTemplateColumns={{ base: "1fr", md: "8rem minmax(0, 1fr) 12rem" }}
            gap="3"
            px="4"
            py="3"
            borderBottomWidth="1px"
            borderColor="signal.rule"
            css={{
              "&[data-current]": { bg: "signal.accentSoft" },
              "&:last-child": { borderBottomWidth: "0" },
            }}
          >
            <Box>
              <StatusBadge status={trial.status} />
            </Box>
            <Stack gap="1" minW="0">
              <Ident fontWeight="500">{trial.fault}</Ident>
              {trial.error ? (
                <Box color="verdict.failed.fg" fontSize="1" lineClamp="2">
                  {trial.error}
                </Box>
              ) : null}
            </Stack>
            <HStack gap="3" justify={{ md: "flex-end" }} color="signal.quiet" fontSize="1">
              <span>
                {trial.calls} calls, {trial.deliveries} webhooks
              </span>
              {trial.record ? (
                <Link to="/records/$" params={{ _splat: trial.record }}>
                  Record
                </Link>
              ) : null}
            </HStack>
          </styled.li>
        ))}
      </styled.ul>
    </Panel>
  )
}

const toggle = css({
  px: "3",
  h: "8",
  display: "inline-flex",
  alignItems: "center",
  fontSize: "1.5",
  fontWeight: "500",
  color: "signal.quiet",
  rounded: "md",
  _hover: { color: "signal.ink" },
  "&[data-on]": {
    bg: "signal.panel",
    color: "signal.ink",
    boxShadow: "0 0 0 1px {colors.signal.rule}",
  },
})

function ViewSwitch({ runId, view }: { readonly runId: string; readonly view: View }) {
  return (
    <HStack as="nav" aria-label="View" gap="1" p="1" bg="signal.raised" rounded="lg">
      <Link
        className={toggle}
        to="/runs/$runId"
        params={{ runId }}
        search={{}}
        data-on={view === "grid" || undefined}
        aria-pressed={view === "grid"}
        replace
      >
        Grid
      </Link>
      <Link
        className={toggle}
        to="/runs/$runId"
        params={{ runId }}
        search={{ view: "list" }}
        data-on={view === "list" || undefined}
        aria-pressed={view === "list"}
        replace
      >
        List
      </Link>
    </HStack>
  )
}

function MatrixRun({ run }: { readonly run: MatrixHistory }) {
  const { view = "grid" } = Route.useSearch()

  return (
    <>
      <PageTitle
        title={run.testId}
        detail={
          <>
            <Ident>danwo matrix</Ident> run of {run.trials.length} faults, started{" "}
            <Started at={run.startedAt} />, took {duration(run.durationMs)}
          </>
        }
        actions={<Command text={`danwo matrix ${run.file}`} />}
      />
      <Invariant run={run} />
      {run.trials.length === 0 ? (
        <Empty
          title="No faults ran"
          hint="Faults only run once the clean run passes. Fix the clean run and run the matrix again."
          command={`danwo matrix ${run.file}`}
        />
      ) : (
        <Stack gap="4">
          <HStack justify="space-between" gap="4" flexWrap="wrap">
            <Legend />
            <ViewSwitch runId={run.id} view={view} />
          </HStack>
          {view === "list" ? <TrialList run={run} /> : <Heatmap run={run} />}
        </Stack>
      )}
      {run.lint && run.lint.length > 0 ? (
        <Section title="Integration lint" count={run.lint.reduce((sum, l) => sum + l.count, 0)}>
          <Panel p="5">
            <BarList
              label="Lint findings by rule"
              bars={run.lint.map((lint) => ({
                key: `${lint.severity} ${lint.rule}`,
                label: <LintLabel rule={lint.rule} severity={lint.severity} />,
                value: lint.count,
                shown: String(lint.count),
                tone: lint.severity === "error" ? "failed" : "flaky",
              }))}
            />
          </Panel>
        </Section>
      ) : null}
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
            It may have been pruned; the history keeps the latest 200 runs.{" "}
            <Link to="/">See all runs</Link>
          </>
        }
      />
    )

  return run.kind === "test" ? <TestRun run={run} /> : <MatrixRun run={run} />
}
