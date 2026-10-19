import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type ReactNode, type RefObject, useRef, useState } from "react"

import { fetchRuns } from "../api.ts"
import { ago, dollars, duration, percent, when } from "../components/format.ts"
import { useFilter, useListKeys } from "../components/keys.ts"
import { Sparkline } from "../components/sparkline.tsx"
import {
  Empty,
  Ident,
  ListFilter,
  PageTitle,
  Panel,
  type Share,
  StatusBadge,
  Swatch,
  VerdictStrip,
} from "../components/status.tsx"
import type { RunRow } from "../data/runs.ts"
import type { Health } from "../data/trend.ts"

const PAGE_SIZE = 50

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { page?: number } =>
    typeof search.page === "number" && search.page > 0 ? { page: search.page } : {},
  loaderDeps: ({ search }) => ({ page: search.page ?? 0 }),
  loader: ({ deps }) => fetchRuns({ data: deps.page }),
  component: RunsPage,
})

/** The one word a run's result reads as: its worst verdict. */
function verdictOf(row: RunRow): string {
  const { counts } = row

  if (counts.failed > 0) return "failed"
  if (counts.flaky > 0) return "flaky"
  if (counts.passed > 0) return "passed"
  if (counts.notJudged > 0) return "not-judged"

  return counts.invalid > 0 ? "invalid" : "skipped"
}

function sharesOf(row: RunRow): Share[] {
  return [
    { tone: "passed", count: row.counts.passed, label: "passed" },
    { tone: "flaky", count: row.counts.flaky, label: "flaky" },
    { tone: "failed", count: row.counts.failed, label: "failed" },
    { tone: "notJudged", count: row.counts.notJudged, label: "not judged" },
    {
      tone: "invalid",
      count: row.counts.invalid + row.counts.skipped,
      label: "invalid or skipped",
    },
  ]
}

/** The result in words, such as "12 passed, 1 failed". */
function countLine(row: RunRow): string {
  return sharesOf(row)
    .filter((share) => share.count > 0)
    .map((share) => `${share.count} ${share.label}`)
    .join(", ")
}

/** A test run's icon: one checked box. */
function TestIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="12" height="12" rx="3" />
      <path d="m5.5 8.2 1.8 1.8 3.3-3.6" />
    </svg>
  )
}

/** A matrix run's icon: the grid of faults it ran. */
function MatrixIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {[2, 6.5, 11].flatMap((y) =>
        [2, 6.5, 11].map((x) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="3.2"
            height="3.2"
            rx="0.8"
            opacity={x === y ? 1 : 0.45}
          />
        )),
      )}
    </svg>
  )
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function Figure({
  label,
  value,
  detail,
  chart,
}: {
  readonly label: string
  readonly value: ReactNode
  readonly detail?: ReactNode
  readonly chart?: ReactNode
}) {
  return (
    <Stack
      gap="2"
      p="5"
      minW="0"
      borderColor="signal.rule"
      borderLeftWidth={{ base: "0", md: "1px" }}
      _first={{ borderLeftWidth: "0" }}
    >
      <Box color="signal.quiet" fontSize="1.5">
        {label}
      </Box>
      <HStack gap="2" alignItems="baseline" flexWrap="wrap">
        <styled.span fontSize="7" fontWeight="500" letterSpacing="-0.02em" lineHeight="1.1">
          {value}
        </styled.span>
        {detail === undefined ? null : (
          <styled.span color="signal.quiet" fontSize="1.5">
            {detail}
          </styled.span>
        )}
      </HStack>
      <Box h="7">{chart}</Box>
    </Stack>
  )
}

/** One square per recent run, oldest on the left, red where something failed. */
function RunRibbon({ health }: { readonly health: Health }) {
  return (
    <HStack gap="1" h="full" alignItems="center" flexWrap="wrap">
      {health.points.map((point) => (
        <Link
          key={point.id}
          to="/runs/$runId"
          params={{ runId: point.id }}
          title={`${when(point.startedAt)}: ${point.failed ? "something failed" : "all passed"}`}
          aria-label={`Run ${when(point.startedAt)}`}
        >
          <Swatch
            tone={point.failed ? "failed" : point.passRate === null ? "invalid" : "passed"}
            w="2.5"
            h="5"
            display="block"
          />
        </Link>
      ))}
    </HStack>
  )
}

/** The project's health over its recent runs, each figure with the trend behind it. */
function HealthPanel({ health }: { readonly health: Health }) {
  const { points } = health
  const runTime = median(points.map((point) => point.durationMs))

  return (
    <Panel as="section" aria-label="Health" mb="8">
      <Box px="5" pt="4" color="signal.quiet" fontSize="1.5">
        The latest {health.window} {health.window === 1 ? "run" : "runs"}
      </Box>
      <Grid gridTemplateColumns={{ base: "1fr 1fr", md: "repeat(4, minmax(0, 1fr))" }}>
        <Figure
          label="Pass rate"
          value={percent(health.passRate)}
          detail={health.flaky > 0 ? `${health.flaky} flaky` : undefined}
          chart={
            <Sparkline
              values={points.map((p) => p.passRate)}
              range={[0, 1]}
              label="Pass rate per run, oldest to newest"
              color="var(--danwo-colors-verdict-passed-solid)"
            />
          }
        />
        <Figure
          label="Runs with a failure"
          value={health.failedRuns}
          detail={`of ${health.window}`}
          chart={<RunRibbon health={health} />}
        />
        <Figure
          label="Run time"
          value={duration(runTime)}
          detail="median"
          chart={
            <Sparkline
              values={points.map((p) => p.durationMs)}
              label="Run time per run, oldest to newest"
            />
          }
        />
        <Figure
          label="Model spend"
          value={dollars(health.costUsd)}
          detail={
            health.modelCalls === 0
              ? "no model calls"
              : `${health.modelCalls} calls, ${percent(health.cacheHitRate)} from the cache`
          }
          chart={
            <Sparkline
              values={points.map((p) => p.costUsd)}
              label="Spend per run, oldest to newest"
            />
          }
        />
      </Grid>
    </Panel>
  )
}

const Th = styled("th", {
  base: {
    textAlign: "left",
    fontWeight: "500",
    color: "signal.quiet",
    fontSize: "1.5",
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
    verticalAlign: "middle",
  },
})

function RunLine({
  row,
  current,
  now,
}: {
  readonly row: RunRow
  readonly current: boolean
  readonly now: number
}) {
  return (
    <styled.tr
      data-row
      data-current={current || undefined}
      position="relative"
      _hover={{ bg: "signal.raised" }}
      css={{
        "&[data-current]": { bg: "signal.accentSoft" },
        "&:last-child td": { borderBottomWidth: "0" },
      }}
    >
      <Td w="7rem">
        <StatusBadge status={verdictOf(row)} />
      </Td>
      <Td minW="0">
        <Stack gap="1">
          <Link to="/runs/$runId" params={{ runId: row.id }}>
            <styled.span
              fontWeight="500"
              color="signal.ink"
              _hover={{ color: "signal.accent" }}
              overflowWrap="anywhere"
              css={{ "&::after": { content: '""', position: "absolute", inset: "0" } }}
            >
              {row.title}
            </styled.span>
          </Link>
          <HStack gap="3" color="signal.quiet" fontSize="1">
            <VerdictStrip shares={sharesOf(row)} width="5rem" />
            <span>{countLine(row)}</span>
          </HStack>
        </Stack>
      </Td>
      <Td
        w="10rem"
        color="signal.quiet"
        whiteSpace="nowrap"
        display={{ base: "none", md: "table-cell" }}
      >
        <HStack gap="2">
          {row.kind === "matrix" ? <MatrixIcon /> : <TestIcon />}
          <Ident fontSize="1.5">danwo {row.kind}</Ident>
        </HStack>
      </Td>
      <Td w="6rem" textAlign="right" color="signal.quiet">
        {duration(row.durationMs)}
      </Td>
      <Td
        w="7rem"
        textAlign="right"
        color="signal.quiet"
        display={{ base: "none", lg: "table-cell" }}
      >
        {row.modelCalls > 0 ? dollars(row.costUsd) : "–"}
      </Td>
      <Td w="9rem" textAlign="right" color="signal.quiet" whiteSpace="nowrap">
        <time dateTime={row.startedAt} title={when(row.startedAt)} suppressHydrationWarning>
          {ago(row.startedAt, now)}
        </time>
      </Td>
    </styled.tr>
  )
}

/** What the filter searches in a row: its title, command and verdicts. */
function textOf(row: RunRow): string {
  return `${row.title} danwo ${row.kind} ${countLine(row)} ${verdictOf(row)}`
}

/** The runs on this page that match the filter, j and k moving through them. */
function RunsTable({
  shown,
  deferred,
  box,
}: {
  readonly shown: readonly RunRow[]
  readonly deferred: string
  readonly box: RefObject<HTMLInputElement | null>
}) {
  const list = useRef<HTMLTableSectionElement>(null)
  const current = useListKeys(list, shown.length, box)
  const [now] = useState(() => Date.now())

  return (
    <Panel overflow="hidden">
      <styled.table w="full" borderCollapse="collapse" fontSize="1.5">
        <thead>
          <tr>
            <Th>Result</Th>
            <Th>What ran</Th>
            <Th display={{ base: "none", md: "table-cell" }}>Command</Th>
            <Th textAlign="right">Time</Th>
            <Th textAlign="right" display={{ base: "none", lg: "table-cell" }}>
              Spend
            </Th>
            <Th textAlign="right">Started</Th>
          </tr>
        </thead>
        <tbody ref={list}>
          {shown.map((row, i) => (
            <RunLine key={row.id} row={row} current={i === current} now={now} />
          ))}
        </tbody>
      </styled.table>
      {shown.length === 0 ? (
        <Box p="6" color="signal.quiet" textAlign="center">
          No run on this page matches “{deferred}”.
        </Box>
      ) : null}
    </Panel>
  )
}

/** Links to newer and older pages of runs, when there is more than one. */
function Pager({ page, pages }: { readonly page: number; readonly pages: number }) {
  if (pages <= 1) return null

  return (
    <HStack justify="flex-end" gap="4" mt="4" fontSize="1.5" color="signal.quiet">
      {page > 0 ? (
        <Link to="/" search={page > 1 ? { page: page - 1 } : {}}>
          Newer
        </Link>
      ) : null}
      <span>
        Page {page + 1} of {pages}
      </span>
      {page + 1 < pages ? (
        <Link to="/" search={{ page: page + 1 }}>
          Older
        </Link>
      ) : null}
    </HStack>
  )
}

function RunsPage() {
  const { rows, total, health } = Route.useLoaderData()
  const { page = 0 } = Route.useSearch()
  const filter = useFilter(rows, textOf)

  if (total === 0)
    return (
      <Empty
        title="No runs yet"
        hint="Run your tests once and they show up here, with every flight record they kept. A matrix run then breaks each provider route and webhook in turn."
        command="danwo test"
      />
    )

  return (
    <>
      <PageTitle
        title="Runs"
        detail={`${total} ${total === 1 ? "run" : "runs"} of danwo test and danwo matrix, newest first`}
        actions={<ListFilter label="Filter runs" placeholder="Filter runs" filter={filter} />}
      />
      {page === 0 ? <HealthPanel health={health} /> : null}
      <RunsTable shown={filter.shown} deferred={filter.deferred} box={filter.box} />
      <Pager page={page} pages={Math.ceil(total / PAGE_SIZE)} />
    </>
  )
}
