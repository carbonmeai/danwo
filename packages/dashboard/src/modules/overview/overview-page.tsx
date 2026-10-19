import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link, useNavigate } from "@tanstack/react-router"

import { Ident } from "../../components/code.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { None, Section, StatCard, StatCards } from "../../components/panel.tsx"
import { Sparkline } from "../../components/sparkline.tsx"
import { Badge } from "../../components/status-badge.tsx"
import { Row, RowList } from "../../components/table.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { duration, percent } from "../../lib/format.ts"
import { LiveRuns } from "../live/live-runs.tsx"
import { type Day, type Figure, type Overview, RANGES, rangeOf } from "./overview-data.ts"

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
  if (figure.now === null || figure.prior === null) return <span>no earlier window to compare</span>

  const delta = figure.now - figure.prior
  const good = delta === 0 || delta > 0 === (better === "up")

  return (
    <span>
      <styled.span color={good ? "verdict.passed.fg" : "verdict.failed.fg"} fontWeight="500">
        {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {shown(Math.abs(delta))}
      </styled.span>{" "}
      vs prior
    </span>
  )
}

/** Runs per day as stacked bars, passed under failed; a day opens its runs. */
function RunsPerDay({ days }: { readonly days: readonly Day[] }) {
  const most = Math.max(1, ...days.map((day) => day.passed + day.failed))

  return (
    <Box>
      <HStack gap="4" mb="3" fontSize="1" color="ink.muted">
        <HStack gap="1.5">
          <styled.span w="2" h="2" rounded="sm" bg="verdict.passed.solid" /> Passed
        </HStack>
        <HStack gap="1.5">
          <styled.span w="2" h="2" rounded="sm" bg="verdict.failed.solid" /> Had a failure
        </HStack>
      </HStack>
      <HStack gap="1" alignItems="flex-end" h="40" role="list" aria-label="Runs per day">
        {days.map((day) => {
          const total = day.passed + day.failed

          return (
            <Link
              key={day.day}
              to="/runs"
              search={{ day: day.day }}
              role="listitem"
              title={`${day.day}: ${day.passed} passed, ${day.failed} with a failure`}
              aria-label={`${day.day}: ${total} runs`}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}
            >
              <Stack
                gap="0.5"
                w="full"
                style={{ height: `${(total / most) * 100}%` }}
                minH={total > 0 ? "1" : "0"}
              >
                <Box bg="verdict.failed.solid" rounded="sm" style={{ flex: day.failed }} />
                <Box bg="verdict.passed.solid" rounded="sm" style={{ flex: day.passed }} />
              </Stack>
            </Link>
          )
        })}
      </HStack>
      <HStack justify="space-between" mt="2" fontSize="1" color="ink.faint">
        <span>{days[0]?.day}</span>
        <span>{days.at(-1)?.day}</span>
      </HStack>
    </Box>
  )
}

/** A line across the window's runs, oldest on the left: their pass rate or their run time. */
function DayLine({
  title,
  values,
  range,
  color,
}: {
  readonly title: string
  readonly values: readonly (number | null)[]
  readonly range?: readonly [number, number]
  readonly color?: string
}) {
  return (
    <Section title={title}>
      {values.every((value) => value === null) ? (
        <None>Nothing ran in this window.</None>
      ) : (
        <Box h="32">
          <Sparkline
            label={title}
            values={values}
            fluid
            height={120}
            {...(range && { range })}
            {...(color && { color })}
          />
        </Box>
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
  const { days } = overview

  return (
    <Page
      crumbs={["Overview"]}
      title="Overview"
      detail={`The last ${overview.range} days of danwo test and danwo matrix in this project`}
      actions={
        <Select
          aria-label="Date range"
          value={overview.range}
          onChange={(event) =>
            void navigate({
              to: "/",
              search: { range: rangeOf(event.target.value) ?? 30 },
              replace: true,
            })
          }
        >
          {RANGES.map((range) => (
            <option key={range} value={range}>
              Last {range} days
            </option>
          ))}
        </Select>
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
              <styled.span color="ink.muted" fontSize="1">
                A day opens its runs
              </styled.span>
            }
          >
            <RunsPerDay days={days} />
          </Section>
          <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="2" mt="2">
            <DayLine
              title="Pass rate trend"
              values={overview.trend.map((run) => run.passRate)}
              range={[0, 1]}
            />
            <DayLine
              title="Run duration"
              values={overview.trend.map((run) => run.durationMs)}
              color="var(--danwo-colors-series-2)"
            />
          </Grid>
          <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="2" mt="2">
            <Section title="Worth a look" count={overview.failing.length}>
              {overview.failing.length === 0 ? (
                <None>No run failed in this window.</None>
              ) : (
                <RowList>
                  {overview.failing.map((run) => (
                    <Row key={run.id} display="flex" gap="3" alignItems="center">
                      <Badge tone="failed">{run.failed} failed</Badge>
                      <Link to="/runs/$runId" params={{ runId: run.id }}>
                        <styled.span fontWeight="500" overflowWrap="anywhere">
                          {run.title}
                        </styled.span>
                      </Link>
                      <styled.span ml="auto" color="ink.muted" fontSize="1" whiteSpace="nowrap">
                        {run.kind === "matrix" ? "matrix · " : ""}
                        <TimeAgo at={run.startedAt} />
                      </styled.span>
                    </Row>
                  ))}
                </RowList>
              )}
            </Section>
            <Section title="Breaks under faults" count={overview.broken.length}>
              {overview.broken.length === 0 ? (
                <None>No test broke under the fault matrix in this window.</None>
              ) : (
                <RowList>
                  {overview.broken.map((test) => (
                    <Row key={test.id}>
                      <Stack gap="1">
                        <Link to="/runs/$runId" params={{ runId: test.runId }}>
                          <styled.span fontWeight="500" overflowWrap="anywhere">
                            {test.id}
                          </styled.span>
                        </Link>
                        <HStack gap="1.5" flexWrap="wrap">
                          {test.faults.map((fault) => (
                            <Ident key={fault} color="verdict.failed.fg" fontSize="1">
                              {fault}
                            </Ident>
                          ))}
                        </HStack>
                      </Stack>
                    </Row>
                  ))}
                </RowList>
              )}
            </Section>
          </Grid>
        </>
      )}
    </Page>
  )
}
