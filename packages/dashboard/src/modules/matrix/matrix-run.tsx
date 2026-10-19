import type { MatrixHistory } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { HStack, Stack } from "@danwo/ui/jsx"
import { TabTrigger, Tabs, TabsList } from "@danwo/ui/primitives/tabs"
import { Span } from "@danwo/ui/primitives/typography"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { BarList } from "../../components/bar-list.tsx"
import { Command, Ident } from "../../components/code.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Section } from "../../components/panel.tsx"
import { LintLabel, Swatch } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { duration } from "../../lib/format.ts"
import { toneOf, wordOf } from "../../lib/verdicts.ts"
import { RunMatrix } from "../live/run-actions.tsx"
import { FaultHeatmap } from "./fault-heatmap.tsx"
import { InvariantPanel } from "./invariant-panel.tsx"
import { LEGEND } from "./matrix-values.ts"
import { TrialList } from "./trial-list.tsx"

/** How the trials show: the heatmap, or a list with the failures first. */
export type MatrixView = "grid" | "list"

function Legend() {
  return (
    <HStack role="list" aria-label="Legend" gap="4" flexWrap="wrap" fontSize="1" color="ink.muted">
      {LEGEND.map(([status, meaning]) => (
        <HStack role="listitem" key={status} gap="1.5">
          <Swatch tone={toneOf(status)} w="2" h="2" rounded="2px" />
          <Span>
            <Span color="ink.soft" fontWeight="500">
              {wordOf(status)}
            </Span>{" "}
            {meaning}
          </Span>
        </HStack>
      ))}
    </HStack>
  )
}

/** The grid or the list, as the library's tabs; each tab is a link so the view is in the address. */
function ViewSwitch({ runId, view }: { readonly runId: string; readonly view: MatrixView }) {
  return (
    <Tabs value={view}>
      <TabsList aria-label="View">
        <TabTrigger value="grid" asChild>
          <Link to="/runs/$runId" params={{ runId }} search={{}} replace>
            <Icons.grid size={13} />
            Grid
          </Link>
        </TabTrigger>
        <TabTrigger value="list" asChild>
          <Link to="/runs/$runId" params={{ runId }} search={{ view: "list" }} replace>
            <Icons.listBullet size={13} />
            List
          </Link>
        </TabTrigger>
      </TabsList>
    </Tabs>
  )
}

/** A `danwo matrix` run: what must hold, how much held, and every trial as a grid or a list. */
export function MatrixRun({
  run,
  view,
  crumbs,
  focus,
}: {
  readonly run: MatrixHistory
  readonly view: MatrixView
  readonly crumbs: ReactNode
  /** The trial the page's address points at, by its fault. */
  readonly focus?: string | undefined
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
      actions={
        <>
          <Command text={`danwo matrix ${run.file}`} />
          <RunMatrix testId={run.testId} />
        </>
      }
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
          {view === "list" ? (
            <TrialList run={run} focus={focus} />
          ) : (
            <FaultHeatmap run={run} focus={focus} />
          )}
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
