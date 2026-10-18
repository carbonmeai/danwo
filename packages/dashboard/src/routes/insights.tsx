import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useRef } from "react"

import { fetchInsights } from "../api.ts"
import { BarList } from "../components/bars.tsx"
import { dollars, duration, percent, when } from "../components/format.ts"
import { useListKeys } from "../components/keys.ts"
import { Sparkline } from "../components/sparkline.tsx"
import {
  Empty,
  KeyHint,
  LintLabel,
  PageTitle,
  Panel,
  Section,
  StatusBadge,
  Swatch,
  toneOf,
  wordOf,
} from "../components/status.tsx"
import type { CachePoint, Insights, Outcome, TestInsight } from "../data/insights.ts"

export const Route = createFileRoute("/insights")({
  loader: () => fetchInsights(),
  component: InsightsPage,
})

const TOP = 10

/** A test's verdict in each run it appeared in, oldest on the left. */
function OutcomeStrip({ outcomes }: { readonly outcomes: readonly Outcome[] }) {
  return (
    <HStack gap="1" flexWrap="wrap" aria-label="Verdict per run, oldest first">
      {outcomes.map((outcome) => (
        <Link
          key={outcome.run}
          to="/runs/$runId"
          params={{ runId: outcome.run }}
          title={`${wordOf(outcome.status)} in ${outcome.run}`}
          aria-label={`${wordOf(outcome.status)} in ${outcome.run}`}
        >
          <Swatch tone={toneOf(outcome.status)} w="2.5" h="5" display="block" />
        </Link>
      ))}
    </HStack>
  )
}

function FlakyTests({ insights }: { readonly insights: Insights }) {
  const list = useRef<HTMLUListElement>(null)
  const current = useListKeys(list, insights.flaky.length)

  if (insights.flaky.length === 0)
    return (
      <Panel p="6" color="signal.quiet">
        No test has flipped between passing and failing. A test that passes only on a retry shows up
        here, with its verdict in every run.
      </Panel>
    )

  return (
    <Panel overflow="hidden">
      <styled.ul ref={list} aria-label="Flaky tests">
        {insights.flaky.map((test, i) => (
          <Grid
            as="li"
            key={test.id}
            data-row
            data-current={i === current || undefined}
            gridTemplateColumns={{ base: "1fr", md: "minmax(0, 2fr) minmax(0, 2fr) 9rem" }}
            gap="3"
            px="4"
            py="3"
            alignItems="center"
            borderBottomWidth="1px"
            borderColor="signal.rule"
            _last={{ borderBottomWidth: "0" }}
            css={{ "&[data-current]": { bg: "signal.accentSoft" } }}
          >
            <Stack gap="1" minW="0">
              <Link to="/runs/$runId" params={{ runId: test.lastRun }}>
                <styled.span fontWeight="500" overflowWrap="anywhere">
                  {test.id}
                </styled.span>
              </Link>
              <styled.span color="signal.quiet" fontSize="1">
                {test.flaky} flaky, {test.failed} failed, {test.flips}{" "}
                {test.flips === 1 ? "flip" : "flips"} in {test.runs} runs
              </styled.span>
            </Stack>
            <OutcomeStrip outcomes={insights.history[test.id] ?? []} />
            <Box justifySelf={{ md: "end" }}>
              <StatusBadge status={test.lastStatus} />
            </Box>
          </Grid>
        ))}
      </styled.ul>
    </Panel>
  )
}

function TestLink({ test }: { readonly test: TestInsight }) {
  return (
    <Link to="/runs/$runId" params={{ runId: test.lastRun }} title={test.id}>
      {test.id}
    </Link>
  )
}

function CacheTrend({ points }: { readonly points: readonly CachePoint[] }) {
  if (points.length === 0)
    return (
      <Panel p="6" color="signal.quiet">
        No run has used the replay cache yet. Agent steps record on their first run and replay
        without the model after that.
      </Panel>
    )

  const last = points.at(-1)
  const average = points.reduce((sum, p) => sum + p.rate, 0) / points.length

  return (
    <Panel p="5">
      <Grid
        gridTemplateColumns={{ base: "1fr", md: "12rem minmax(0, 1fr)" }}
        gap="6"
        alignItems="center"
      >
        <Stack gap="1">
          <styled.span fontSize="7" fontWeight="500" letterSpacing="-0.02em" lineHeight="1.1">
            {percent(last?.rate ?? null)}
          </styled.span>
          <styled.span color="signal.quiet" fontSize="1.5">
            of agent steps replayed in the latest run, {percent(average)} on average
          </styled.span>
        </Stack>
        <Box overflow="hidden">
          <Sparkline
            values={points.map((p) => p.rate)}
            range={[0, 1]}
            width={640}
            height={72}
            fluid
            label={`Replay cache hit rate per run, from ${when(points[0]?.startedAt ?? "")} to ${when(last?.startedAt ?? "")}`}
          />
        </Box>
      </Grid>
    </Panel>
  )
}

function InsightsPage() {
  const insights = Route.useLoaderData()

  if (insights.runs === 0)
    return (
      <Empty
        title="No test runs yet"
        hint="Insights read the runs danwo keeps in .danwo/history: which tests flip, which are slow, what they cost the model."
        command="danwo test"
      />
    )

  const slowest = insights.slowest.slice(0, TOP)
  const costliest = insights.costliest.slice(0, TOP)

  return (
    <>
      <PageTitle
        title="Insights"
        detail={`Across the latest ${insights.runs} test ${insights.runs === 1 ? "run" : "runs"}`}
        actions={<KeyHint />}
      />
      <Section title="Flaky tests" count={insights.flaky.length}>
        <FlakyTests insights={insights} />
      </Section>
      <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} columnGap="6">
        <Section title="Slowest tests">
          <Panel p="5">
            <BarList
              label="Slowest tests by average time"
              bars={slowest.map((test) => ({
                key: test.id,
                label: <TestLink test={test} />,
                value: test.averageMs,
                shown: duration(test.averageMs),
                tone: "quiet",
              }))}
            />
          </Panel>
        </Section>
        <Section title="Costliest tests">
          {costliest.length === 0 ? (
            <Panel p="6" color="signal.quiet">
              No test has called a model. Agent steps that replay from the cache cost nothing.
            </Panel>
          ) : (
            <Panel p="5">
              <BarList
                label="Costliest tests by model spend"
                bars={costliest.map((test) => ({
                  key: test.id,
                  label: <TestLink test={test} />,
                  value: test.costUsd,
                  shown: dollars(test.costUsd),
                }))}
              />
            </Panel>
          )}
        </Section>
      </Grid>
      <Section title="Replay cache">
        <CacheTrend points={insights.cache} />
      </Section>
      <Section
        title="Integration lint"
        count={insights.lint.reduce((sum, rule) => sum + rule.count, 0)}
      >
        {insights.lint.length === 0 ? (
          <Panel p="6" color="signal.quiet">
            The integration lint found nothing in these runs: no forged webhooks accepted, no
            missing idempotency keys, no secret keys in the browser.
          </Panel>
        ) : (
          <Panel p="5">
            <BarList
              label="Lint findings by rule"
              bars={insights.lint.map((rule) => ({
                key: rule.rule,
                label: <LintLabel rule={rule.rule} severity={rule.severity} />,
                value: rule.count,
                shown: `${rule.count} in ${rule.runs}`,
                tone: rule.severity === "error" ? "failed" : "flaky",
              }))}
            />
          </Panel>
        )}
      </Section>
    </>
  )
}
