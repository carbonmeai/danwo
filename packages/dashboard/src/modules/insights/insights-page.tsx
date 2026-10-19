import { Icons } from "@danwo/ui/icons/base"
import { Grid } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { BarList } from "../../components/bar-list.tsx"
import { KeyHint } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { None, Section, StatCard, StatCards } from "../../components/panel.tsx"
import { LintLabel } from "../../components/status-badge.tsx"
import { dollars, duration, percent } from "../../lib/format.ts"
import { CacheTrend } from "./cache-trend.tsx"
import { FlakyTests } from "./flaky-tests.tsx"
import type { Insights, TestInsight } from "./insights-data.ts"
import { type TableOrder, TestTable } from "./test-table.tsx"

const TOP = 10

function TestLink({ test }: { readonly test: TestInsight }) {
  return (
    <Link to="/tests/$testId" params={{ testId: test.id }} title={test.id}>
      {test.id}
    </Link>
  )
}

/** The four headline figures: flaky tests, the slowest test, model spend and the replay cache. */
function InsightCards({ insights }: { readonly insights: Insights }) {
  const slowest = insights.slowest[0]
  const spend = insights.costliest.reduce((sum, test) => sum + test.costUsd, 0)
  const cache = insights.cache.at(-1)?.rate ?? null
  const findings = insights.lint.reduce((sum, rule) => sum + rule.count, 0)

  return (
    <StatCards>
      <StatCard
        label="Flaky tests"
        icon={<Icons.refresh size={13} />}
        value={insights.flaky.length}
        sub="flipped between passing and failing"
      />
      <StatCard
        label="Slowest test"
        icon={<Icons.clock size={13} />}
        value={slowest ? duration(slowest.averageMs) : "–"}
        sub={slowest ? slowest.id : "nothing timed yet"}
      />
      <StatCard
        label="Spend on tests"
        icon={<Icons.dollar size={13} />}
        value={dollars(spend)}
        sub={
          cache === null
            ? "no agent steps replayed yet"
            : `${percent(cache)} of agent steps replayed in the latest run`
        }
      />
      <StatCard
        label="Lint findings"
        icon={<Icons.shieldCheck size={13} />}
        value={findings}
        sub={`${insights.lint.length} ${insights.lint.length === 1 ? "rule" : "rules"}`}
      />
    </StatCards>
  )
}

/** Which tests flip, which are slow, what they cost the model, and what the lint found. */
export function InsightsPage({
  insights,
  sorting = { sort: "flake", ascending: false },
}: {
  readonly insights: Insights
  /** How the table of every test is sorted. */
  readonly sorting?: TableOrder
}) {
  if (insights.runs === 0)
    return (
      <Page crumbs={["Insights"]} title="Insights">
        <Empty
          title="No test runs yet"
          hint="Insights read the runs danwo keeps in .danwo/history: which tests flip, which are slow, what they cost the model."
          command="danwo test"
        />
      </Page>
    )

  const slowest = insights.slowest.slice(0, TOP)
  const costliest = insights.costliest.slice(0, TOP)

  return (
    <Page
      crumbs={["Insights"]}
      title="Insights"
      detail={`Across the latest ${insights.runs} test ${insights.runs === 1 ? "run" : "runs"}`}
      actions={<KeyHint />}
    >
      <InsightCards insights={insights} />
      <Section title="Flaky tests" count={insights.flaky.length}>
        <FlakyTests insights={insights} />
      </Section>
      <Section title="Every test" count={insights.breakdown.length} bare>
        <TestTable rows={insights.breakdown} sorting={sorting} />
      </Section>
      <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} columnGap="2">
        <Section title="Slowest tests">
          <BarList
            label="Slowest tests by average time"
            bars={slowest.map((test) => ({
              key: test.id,
              label: <TestLink test={test} />,
              value: test.averageMs,
              shown: duration(test.averageMs),
            }))}
          />
        </Section>
        <Section title="Costliest tests">
          {costliest.length === 0 ? (
            <None>
              No test has called a model. Agent steps that replay from the cache cost nothing.
            </None>
          ) : (
            <BarList
              label="Costliest tests by model spend"
              bars={costliest.map((test) => ({
                key: test.id,
                label: <TestLink test={test} />,
                value: test.costUsd,
                shown: dollars(test.costUsd),
              }))}
            />
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
          <None>
            The integration lint found nothing in these runs: no forged webhooks accepted, no
            missing idempotency keys, no secret keys in the browser.
          </None>
        ) : (
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
        )}
      </Section>
    </Page>
  )
}
