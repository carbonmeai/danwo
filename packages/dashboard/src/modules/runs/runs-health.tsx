import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"

import { StatCard, StatCards } from "../../components/panel.tsx"
import { Sparkline } from "../../components/sparkline.tsx"
import { Swatch } from "../../components/status-badge.tsx"
import { dollars, duration, percent, when } from "../../lib/format.ts"
import type { Health } from "./run-trend.ts"
import { median } from "./runs-values.ts"

/** One bar per recent run, oldest on the left, red where something failed. */
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
            w="1.5"
            h="5"
            rounded="xs"
            display="block"
          />
        </Link>
      ))}
    </HStack>
  )
}

/** The project's health over its recent runs: four cards, each figure with the trend behind it. */
export function RunsHealth({ health }: { readonly health: Health }) {
  const { points } = health
  const runTime = median(points.map((point) => point.durationMs))
  const latest = `${health.window} ${health.window === 1 ? "run" : "runs"}`

  return (
    <Box as="section" aria-label="Health">
      <StatCards>
        <StatCard
          label="Pass rate"
          icon={<Icons.checkCircle size={13} />}
          value={percent(health.passRate)}
          sub={
            health.flaky > 0
              ? `${health.flaky} flaky in the latest ${latest}`
              : `Over the latest ${latest}`
          }
          chart={
            <Sparkline
              fluid
              values={points.map((p) => p.passRate)}
              range={[0, 1]}
              label="Pass rate per run, oldest to newest"
              color="var(--danwo-colors-verdict-passed-solid)"
            />
          }
        />
        <StatCard
          label="Runs with a failure"
          icon={<Icons.warn size={13} />}
          value={health.failedRuns}
          sub={`of the latest ${latest}`}
          chart={<RunRibbon health={health} />}
        />
        <StatCard
          label="Run time"
          icon={<Icons.clock size={13} />}
          value={duration(runTime)}
          sub="median"
          chart={
            <Sparkline
              fluid
              values={points.map((p) => p.durationMs)}
              label="Run time per run, oldest to newest"
            />
          }
        />
        <StatCard
          label="Model spend"
          icon={<Icons.dollar size={13} />}
          value={dollars(health.costUsd)}
          sub={
            health.modelCalls === 0
              ? "no model calls"
              : `${health.modelCalls} calls · ${percent(health.cacheHitRate)} from the cache`
          }
          chart={
            <Sparkline
              fluid
              values={points.map((p) => p.costUsd)}
              label="Spend per run, oldest to newest"
            />
          }
        />
      </StatCards>
    </Box>
  )
}
