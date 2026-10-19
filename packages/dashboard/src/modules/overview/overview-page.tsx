import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Span } from "@danwo/ui/primitives/typography"
import { Link, useNavigate } from "@tanstack/react-router"

import { StackedBars, TrendLine } from "../../components/charts.tsx"
import { Choice } from "../../components/choice.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { ListRow, ListRows, None, Section, StatCard, StatCards } from "../../components/panel.tsx"
import { VerdictBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { duration, percent } from "../../lib/format.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { type Day, type Figure, type Overview, RANGES, rangeOf } from "./overview-data.ts"

/** How a figure moved against the window before, with the direction that is good for it. */
function Change({
  figure,
  shown,
  better,
}: {
  readonly figure: Figure
  readonly shown: (delta: number) => string
  readonly better: "up" | "down"
}) {
  if (figure.now === null || figure.prior === null) return <Span>no earlier window to compare</Span>

  const delta = figure.now - figure.prior
  const good = delta === 0 || delta > 0 === (better === "up")

  return (
    <Span>
      <Span color={good ? "verdict.passed.fg" : "verdict.failed.fg"} fontWeight="500">
        {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {shown(Math.abs(delta))}
      </Span>{" "}
      vs prior
    </Span>
  )
}

/** Runs per day as stacked bars, passed under failed; a day opens its runs. */
function RunsPerDay({ days }: { readonly days: readonly Day[] }) {
  const navigate = useNavigate()

  return (
    <Box>
      <StackedBars
        label="Runs per day"
        height="11rem"
        points={days.map((day) => ({ label: day.day, passed: day.passed, failed: day.failed }))}
        series={[
          { key: "passed", label: "Passed", color: "var(--danwo-colors-verdict-passed-solid)" },
          {
            key: "failed",
            label: "Had a failure",
            color: "var(--danwo-colors-verdict-failed-solid)",
          },
        ]}
        onPick={(day) => void navigate({ to: "/runs", search: { day } })}
      />
      <Box role="list" aria-label="Days" srOnly>
        {days.map((day) => (
          <Box role="listitem" key={day.day}>
            <Link to="/runs" search={{ day: day.day }}>
              {day.day}: {day.passed} passed, {day.failed} with a failure
            </Link>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** A line across the window's runs, oldest on the left: their pass rate or their run time. */
function DayLine({
  title,
  values,
  range,
  color,
  format,
}: {
  readonly title: string
  readonly values: readonly (number | null)[]
  readonly range?: readonly [number, number]
  readonly color?: string
  readonly format: (value: number) => string
}) {
  return (
    <Section title={title}>
      {values.every((value) => value === null) ? (
        <None>Nothing ran in this window.</None>
      ) : (
        <TrendLine
          label={title}
          values={values}
          height="8rem"
          format={format}
          {...(range && { range })}
          {...(color && { color })}
        />
      )}
    </Section>
  )
}

/** The runs worth a look: the window's failing runs, newest first. */
function Failing({ overview }: { readonly overview: Overview }) {
  return (
    <Section title="Worth a look" count={overview.failing.length}>
      {overview.failing.length === 0 ? (
        <None>No run failed in this window.</None>
      ) : (
        <ListRows>
          {overview.failing.map((run) => (
            <ListRow key={run.id} display="flex" gap="3" alignItems="center">
              <VerdictBadge tone="failed">{run.failed} failed</VerdictBadge>
              <Link to="/runs/$runId" params={{ runId: run.id }}>
                <Span fontWeight="500" overflowWrap="anywhere">
                  {run.title}
                </Span>
              </Link>
              <Span ml="auto" color="ink.muted" fontSize="1" whiteSpace="nowrap">
                {run.kind === "matrix" ? "matrix · " : ""}
                <TimeAgo at={run.startedAt} />
              </Span>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}

/** The tests a fault broke under the matrix in this window, with the faults that did it. */
function Broken({ overview }: { readonly overview: Overview }) {
  return (
    <Section title="Breaks under faults" count={overview.broken.length}>
      {overview.broken.length === 0 ? (
        <None>No test broke under the fault matrix in this window.</None>
      ) : (
        <ListRows>
          {overview.broken.map((test) => (
            <ListRow key={test.id}>
              <Stack gap="1">
                <Link to="/runs/$runId" params={{ runId: test.runId }}>
                  <Span fontWeight="500" overflowWrap="anywhere">
                    {test.id}
                  </Span>
                </Link>
                <HStack gap="1.5" flexWrap="wrap">
                  {test.faults.map((fault) => (
                    <VerdictBadge key={fault} tone="failed" fontFamily="mono">
                      {fault}
                    </VerdictBadge>
                  ))}
                </HStack>
              </Stack>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}

/**
 * The project at a glance: its pass rate, runs, failed tests and run time against the window
 * before, runs per day, the trends, the runs worth a look and the tests a fault breaks.
 */
export function OverviewPage({ overview }: { readonly overview: Overview }) {
  const navigate = useNavigate()

  return (
    <Page
      crumbs={["Overview"]}
      title="Overview"
      detail={`The last ${overview.range} days of danwo test and danwo matrix in this project`}
      actions={
        <Choice
          label="Date range"
          value={String(overview.range)}
          options={RANGES.map((range) => [String(range), `Last ${range} days`] as const)}
          onChange={(value) =>
            void navigate({ to: "/", search: { range: rangeOf(value) ?? 30 }, replace: true })
          }
        />
      }
    >
      <LiveRuns />
      <StatCards columns={4}>
        <StatCard
          label="Pass rate"
          icon={<Icons.checkCircle size={14} />}
          value={percent(overview.passRate.now)}
          sub={
            <Change
              figure={overview.passRate}
              shown={(d) => `${Math.round(d * 100)} pts`}
              better="up"
            />
          }
        />
        <StatCard
          label="Runs"
          icon={<Icons.play size={14} />}
          value={overview.runs.now ?? 0}
          sub={<Change figure={overview.runs} shown={String} better="up" />}
        />
        <StatCard
          label="Failed tests"
          icon={<Icons.warn size={14} />}
          value={overview.failedTests.now ?? 0}
          sub={<Change figure={overview.failedTests} shown={String} better="down" />}
        />
        <StatCard
          label="Average run time"
          icon={<Icons.clock size={14} />}
          value={overview.meanMs.now === null ? "–" : duration(overview.meanMs.now)}
          sub={<Change figure={overview.meanMs} shown={duration} better="down" />}
        />
      </StatCards>
      {overview.runs.now === 0 ? (
        <Empty
          title="Nothing ran in this window"
          hint="Run the tests, or pick a longer window. A matrix run then replays a test under each fault its providers could throw."
          command="danwo test"
        />
      ) : (
        <>
          <Section
            title="Runs per day"
            aside={
              <Span color="ink.muted" fontSize="1">
                A day opens its runs
              </Span>
            }
          >
            <RunsPerDay days={overview.days} />
          </Section>
          <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="2" mt="2">
            <DayLine
              title="Pass rate trend"
              values={overview.trend.map((run) => run.passRate)}
              range={[0, 1]}
              format={(value) => percent(value)}
            />
            <DayLine
              title="Run duration"
              values={overview.trend.map((run) => run.durationMs)}
              color="var(--danwo-colors-series-2)"
              format={duration}
            />
          </Grid>
          <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="2" mt="2">
            <Failing overview={overview} />
            <Broken overview={overview} />
          </Grid>
        </>
      )}
    </Page>
  )
}
