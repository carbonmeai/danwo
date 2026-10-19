import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { MarkdownDocument } from "@danwo/ui/primitives/markdown"
import { Link, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { Pre } from "../../components/code.tsx"
import { SegmentTrack, segment } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Item, None, Section } from "../../components/panel.tsx"
import { Sparkline } from "../../components/sparkline.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { Row, RowList, RowPanel } from "../../components/table.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { duration } from "../../lib/format.ts"
import { FaultHeatmap } from "../matrix/fault-heatmap.tsx"
import { InvariantPanel } from "../matrix/invariant-panel.tsx"
import { Calls, ConsoleLog, Deliveries } from "../record/record-calls.tsx"
import type { RecordView } from "../record/record-data.ts"
import { RecordSteps } from "../record/record-steps.tsx"
import { TimelineLegend, Waterfall } from "../record/record-waterfall.tsx"
import type { Playback } from "../record/use-playback.ts"
import type { TestView } from "./test-data.ts"
import { TAB_WORDS, TEST_TABS, type TestTab, entryLine } from "./test-values.ts"

/** The tabs under the player; each is an address, so a copied link opens on the same tab. */
export function TestTabs({ id, tab }: { readonly id: string; readonly tab: TestTab }) {
  return (
    <Box overflowX="auto" mt="6" mb="3">
      <SegmentTrack role="tablist" aria-label="About this test">
        {TEST_TABS.map((each) => (
          <Link
            key={each}
            to="/tests/$testId"
            params={{ testId: id }}
            search={(prev) => ({ ...prev, tab: each === "steps" ? undefined : each })}
            className={segment}
            role="tab"
            aria-selected={each === tab}
            data-on={each === tab || undefined}
            replace
            resetScroll={false}
          >
            {TAB_WORDS[each]}
          </Link>
        ))}
      </SegmentTrack>
    </Box>
  )
}

/** Every run of the test, newest first, with how long each took as a line across them. */
function History({ view }: { readonly view: TestView }) {
  if (view.entries.length === 0)
    return (
      <Empty
        title="Not run yet"
        hint="Run the test and each run shows up here."
        command="danwo test"
      />
    )

  return (
    <Stack gap="3">
      <HStack gap="3" color="ink.muted" fontSize="1">
        <Sparkline
          label="Time of each run, oldest first"
          values={view.entries.toReversed().map((entry) => entry.durationMs)}
          width={240}
        />
        <span>Time of each run, oldest on the left</span>
      </HStack>
      <RowPanel pt="1.5">
        <RowList aria-label="Runs of this test">
          {view.entries.map((entry) => (
            <Row key={entry.runId} display="flex" alignItems="center" gap="4" flexWrap="wrap">
              <StatusBadge status={entry.status} />
              <Link
                to="/runs/$runId"
                params={{ runId: entry.runId }}
                search={entry.kind === "test" ? { test: view.id } : {}}
              >
                <styled.span fontWeight="500">{entryLine(entry)}</styled.span>
              </Link>
              <styled.span color="ink.muted" ml="auto">
                {duration(entry.durationMs)} · <TimeAgo at={entry.startedAt} />
              </styled.span>
            </Row>
          ))}
        </RowList>
      </RowPanel>
    </Stack>
  )
}

/** The latest matrix run of the test; a picked cell's recording takes over the player above. */
function Matrix({ view }: { readonly view: TestView }) {
  const navigate = useNavigate()

  if (view.matrix === undefined)
    return (
      <Empty
        title="No matrix run yet"
        hint="The matrix records one clean run of this test, then replays it once per fault its providers could throw (a declined card, a 500, a duplicate webhook…) and checks the test's invariant after each."
        {...(view.file !== undefined && { command: `danwo matrix ${view.file}` })}
      />
    )

  return (
    <Stack gap="3">
      <InvariantPanel run={view.matrix} />
      <FaultHeatmap
        run={view.matrix}
        onPick={(trial) => {
          if (trial.record === undefined) return

          void navigate({
            to: "/tests/$testId",
            params: { testId: view.id },
            search: (prev) => ({ ...prev, record: trial.record }),
            replace: true,
            resetScroll: false,
          })
        }}
      />
    </Stack>
  )
}

interface TabProps {
  readonly record: RecordView
  readonly playback: Playback | undefined
}

/** The steps, the picked one in full, and the failure page when the run failed. */
function StepsTab({ record, playback }: TabProps) {
  return (
    <>
      <RecordSteps view={record} playback={playback} />
      {record.page ? (
        <Section title="Failure page">
          <Item px={{ base: "5", md: "8" }} py="6">
            <Box maxW="52rem">
              <MarkdownDocument text={record.page} />
            </Box>
          </Item>
        </Section>
      ) : null}
    </>
  )
}

/** The waterfall, then every provider call and webhook delivery. */
function CallsTab({ record, playback }: TabProps) {
  const { exchanges, deliveries } = record.record

  return (
    <>
      <Section title="Timeline" aside={<TimelineLegend />}>
        {record.timeline.items.length === 0 ? (
          <None>Nothing was timed in this run.</None>
        ) : (
          <Waterfall
            timeline={record.timeline}
            {...(playback && { playheadMs: playback.ms, onSeek: playback.seek })}
          />
        )}
      </Section>
      <Section title="Provider calls" count={exchanges.length}>
        {exchanges.length === 0 ? (
          <None>No calls went through the proxy.</None>
        ) : (
          <Calls exchanges={exchanges} />
        )}
      </Section>
      <Section title="Webhooks" count={deliveries.length}>
        {deliveries.length === 0 ? (
          <None>No webhook deliveries.</None>
        ) : (
          <Deliveries deliveries={deliveries} />
        )}
      </Section>
    </>
  )
}

/** What the emulated providers held when the run ended. */
function StateTab({ record }: TabProps) {
  return (
    <Section title="What the providers held when the run ended">
      <Pre bg="surface.item">{record.state}</Pre>
    </Section>
  )
}

/** The app's errors and warnings, and the screen as text when the run failed. */
function ConsoleTab({ record }: TabProps) {
  const logs = record.record.appLog.filter((log) => log.level === "error" || log.level === "warn")

  return (
    <>
      <Section title="Console" count={logs.length}>
        {logs.length === 0 ? <None>No errors or warnings.</None> : <ConsoleLog logs={logs} />}
      </Section>
      {record.screen ? (
        <Section title="Screen at failure">
          <Pre bg="surface.item">{record.screen}</Pre>
        </Section>
      ) : null}
    </>
  )
}

/** The tabs that read the recording on show. */
const RECORD_TABS: Readonly<
  Record<Exclude<TestTab, "matrix" | "history">, (props: TabProps) => ReactNode>
> = { steps: StepsTab, calls: CallsTab, state: StateTab, console: ConsoleTab }

/** The open tab's content. */
export function TabBody({
  view,
  tab,
  playback,
}: {
  readonly view: TestView
  readonly tab: TestTab
  readonly playback: Playback | undefined
}): ReactNode {
  if (tab === "history") return <History view={view} />
  if (tab === "matrix") return <Matrix view={view} />
  if (view.record === null)
    return <None>This tab reads a recording of the test, and none was kept yet.</None>

  const Tab = RECORD_TABS[tab]

  return <Tab record={view.record} playback={playback} />
}
