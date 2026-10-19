import { Box, HStack, styled } from "@danwo/ui/jsx"
import { Link, useNavigate } from "@tanstack/react-router"

import { Ident } from "../../components/code.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Section } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { RerunTest, RunMatrix } from "../live/run-actions.tsx"
import type { RecordView } from "../record/record-data.ts"
import { RecordPlayer } from "../record/record-player.tsx"
import { CopyPage, Problem } from "../record/record-problem.tsx"
import { type Playback, usePlayback } from "../record/use-playback.ts"
import type { RecordingChoice, TestView } from "./test-data.ts"
import { TabBody, TestTabs } from "./test-tabs.tsx"
import { type TestTab, choiceLabel } from "./test-values.ts"

const Picker = styled("select", {
  base: {
    h: "8",
    px: "2.5",
    maxW: "full",
    rounded: "lg",
    bg: "surface.hover",
    color: "ink.strong",
    fontSize: "1",
    cursor: "pointer",
    outline: "none",
    _focus: { boxShadow: "0 0 0 3px {colors.ring}" },
  },
})

/** Which kept recording the player shows: the latest test run's by default, any other on request. */
function RecordingPicker({ view, shown }: { readonly view: TestView; readonly shown: string }) {
  const navigate = useNavigate()

  if (view.recordings.length < 2) return null

  return (
    <Picker
      aria-label="Which recording"
      value={shown}
      onChange={(event) =>
        void navigate({
          to: "/tests/$testId",
          params: { testId: view.id },
          search: (prev) => ({ ...prev, record: event.target.value, t: undefined }),
          resetScroll: false,
        })
      }
    >
      {view.recordings.map((choice: RecordingChoice) => (
        <option key={choice.dir} value={choice.dir}>
          {choiceLabel(choice)} · {choice.status} · {new Date(choice.startedAt).toLocaleString()}
        </option>
      ))}
    </Picker>
  )
}

/** The recording on show, played back, with what went wrong above it. */
function Player({
  view,
  record,
  playback,
}: {
  readonly view: TestView
  readonly record: RecordView
  readonly playback: Playback | undefined
}) {
  const choice = view.recordings.find((each) => each.dir === record.dir)

  return (
    <>
      <Problem record={record.record} />
      <Section
        title={choice ? choiceLabel(choice) : "Recording"}
        aside={
          <HStack gap="3" color="ink.muted" fontSize="1" flexWrap="wrap">
            <StatusBadge status={record.record.status} />
            <span>
              recorded <TimeAgo at={record.record.startedAt} />
            </span>
            <RecordingPicker view={view} shown={record.dir} />
          </HStack>
        }
      >
        {playback ? (
          <RecordPlayer dir={record.dir} replay={record.replay} playback={playback} />
        ) : (
          <Box color="ink.muted">This recording kept no video or screenshots to play.</Box>
        )}
      </Section>
    </>
  )
}

/** Why there is no recording to play, and how to get one. */
function NoRecording({ view }: { readonly view: TestView }) {
  return (
    <Empty
      title={view.entries.length === 0 ? "Not run yet" : "No recording kept"}
      hint={
        view.entries.length === 0
          ? "Run this test and its recording plays here, step by step, with every provider call and webhook it caused."
          : 'danwo keeps a recording of a run that fails. Rerun it from here to record it whatever happens, or set record: "always" in danwo.config.ts to keep every run\'s.'
      }
      command="danwo test --record always"
    />
  )
}

/** The page once its recording is known: the player and the tabs share one playback. */
function WithRecording({
  view,
  record,
  tab,
}: {
  readonly view: TestView
  readonly record: RecordView
  readonly tab: TestTab
}) {
  const playback = usePlayback(record.replay)
  const playable = record.replay.videos.length > 0 || record.replay.frames.length > 0

  return (
    <>
      <Player view={view} record={record} playback={playable ? playback : undefined} />
      <TestTabs id={view.id} tab={tab} />
      <TabBody view={view} tab={tab} playback={playable ? playback : undefined} />
    </>
  )
}

/**
 * One test: how it did, its latest recording playing at the top (video, steps and the calls behind
 * them moving together), and tabs for its steps, calls, matrix, history, emulator state and console.
 */
export function TestPage({ view, tab }: { readonly view: TestView; readonly tab: TestTab }) {
  const latest = view.entries[0]

  return (
    <Page
      crumbs={[<Link to="/">Tests</Link>, view.id]}
      title={view.id}
      detail={
        <HStack gap="2" flexWrap="wrap" mt="1">
          {latest ? <StatusBadge status={latest.status} /> : <span>Never run</span>}
          {view.file ? <Ident>{view.file}</Ident> : null}
          {latest ? (
            <span>
              last ran <TimeAgo at={latest.startedAt} />
            </span>
          ) : null}
        </HStack>
      }
      actions={
        <>
          {view.record?.page ? <CopyPage text={view.record.page} /> : null}
          <RerunTest testId={view.id} look="grey" />
          <RunMatrix testId={view.id} />
        </>
      }
    >
      {view.record === null ? (
        <>
          <NoRecording view={view} />
          <TestTabs id={view.id} tab={tab} />
          <TabBody view={view} tab={tab} playback={undefined} />
        </>
      ) : (
        <WithRecording key={view.record.dir} view={view} record={view.record} tab={tab} />
      )}
    </Page>
  )
}
