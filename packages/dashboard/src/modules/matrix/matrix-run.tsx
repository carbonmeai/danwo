import type { MatrixHistory } from "@danwo/runner/runner"
import { HStack, Stack, styled } from "@danwo/ui/jsx"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { BarList } from "../../components/bar-list.tsx"
import { Command, Ident } from "../../components/code.tsx"
import { segment, SegmentTrack } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Section } from "../../components/panel.tsx"
import { LintLabel, Swatch } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { duration } from "../../lib/format.ts"
import { toneOf, wordOf } from "../../lib/verdicts.ts"
import { FaultHeatmap } from "./fault-heatmap.tsx"
import { InvariantPanel } from "./invariant-panel.tsx"
import { LEGEND } from "./matrix-values.ts"
import { TrialList } from "./trial-list.tsx"

/** How the trials show: the heatmap, or a list with the failures first. */
export type MatrixView = "grid" | "list"

function Legend() {
  return (
    <HStack as="ul" aria-label="Legend" gap="4" flexWrap="wrap" fontSize="1" color="ink.muted">
      {LEGEND.map(([status, meaning]) => (
        <HStack as="li" key={status} gap="1.5">
          <Swatch tone={toneOf(status)} w="2" h="2" rounded="2px" />
          <span>
            <styled.span color="ink.soft" fontWeight="500">
              {wordOf(status)}
            </styled.span>{" "}
            {meaning}
          </span>
        </HStack>
      ))}
    </HStack>
  )
}

function ViewSwitch({ runId, view }: { readonly runId: string; readonly view: MatrixView }) {
  return (
    <SegmentTrack as="nav" aria-label="View">
      <Link
        className={segment}
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
        className={segment}
        to="/runs/$runId"
        params={{ runId }}
        search={{ view: "list" }}
        data-on={view === "list" || undefined}
        aria-pressed={view === "list"}
        replace
      >
        List
      </Link>
    </SegmentTrack>
  )
}

/** A `danwo matrix` run: what must hold, how much held, and every trial as a grid or a list. */
export function MatrixRun({
  run,
  view,
  crumbs,
}: {
  readonly run: MatrixHistory
  readonly view: MatrixView
  readonly crumbs: ReactNode
}) {
  return (
    <Page
      crumbs={[crumbs, run.testId]}
      title={run.testId}
      detail={
        <>
          <Ident>danwo matrix</Ident> run of {run.trials.length} faults, started{" "}
          <TimeAgo at={run.startedAt} />, took {duration(run.durationMs)}
        </>
      }
      actions={<Command text={`danwo matrix ${run.file}`} />}
    >
      <InvariantPanel run={run} />
      {run.trials.length === 0 ? (
        <Empty
          title="No faults ran"
          hint="Faults only run once the clean run passes. Fix the clean run and run the matrix again."
          command={`danwo matrix ${run.file}`}
        />
      ) : (
        <Stack gap="2" mt="6">
          <HStack justify="space-between" gap="4" flexWrap="wrap">
            <Legend />
            <ViewSwitch runId={run.id} view={view} />
          </HStack>
          {view === "list" ? <TrialList run={run} /> : <FaultHeatmap run={run} />}
        </Stack>
      )}
      {run.lint && run.lint.length > 0 ? (
        <Section title="Integration lint" count={run.lint.reduce((sum, l) => sum + l.count, 0)}>
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
        </Section>
      ) : null}
    </Page>
  )
}
