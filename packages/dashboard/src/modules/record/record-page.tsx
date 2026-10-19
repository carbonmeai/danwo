import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { MarkdownDocument } from "@danwo/ui/primitives/markdown"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"

import { Ident, Pre } from "../../components/code.tsx"
import { Button, KeyHint } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Item, None, Section } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { duration } from "../../lib/format.ts"
import { Calls, ConsoleLog, Deliveries } from "./record-calls.tsx"
import type { RecordView } from "./record-data.ts"
import { RecordPlayer } from "./record-player.tsx"
import { RecordSteps } from "./record-steps.tsx"
import { divergenceLine, runName } from "./record-values.ts"
import { TimelineLegend, Waterfall } from "./record-waterfall.tsx"
import { usePlayback } from "./use-playback.ts"

/** Copies the Markdown failure page, to paste into an issue or an agent's prompt. */
function CopyPage({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      look="primary"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2_000)
        })
      }
    >
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copy size={14} />}
      <span aria-live="polite">{copied ? "Copied" : "Copy failure page"}</span>
    </Button>
  )
}

/** What went wrong in the run: the error, where the body stopped, a diverged replay, notes. */
function Problem({ record }: { readonly record: RecordView["record"] }) {
  if (!record.error && !record.stopped && !record.divergence) return null

  const stopped =
    record.stopped && !record.notes.some((note) => note.includes(record.stopped ?? ""))
      ? record.stopped
      : undefined

  return (
    <Stack
      gap="1.5"
      bg="verdict.failed.bg"
      rounded="14px"
      px="4"
      py="3.5"
      mb="2"
      aria-label="What went wrong"
    >
      {record.error ? (
        <>
          <HStack gap="2" color="verdict.failed.fg" fontWeight="500">
            <Icons.warn size={14} />
            <Ident>{record.error.code}</Ident>
          </HStack>
          <styled.p fontSize="2" fontWeight="500" overflowWrap="anywhere">
            {record.error.message}
          </styled.p>
        </>
      ) : null}
      {[stopped, divergenceLine(record), ...record.notes].map((line) =>
        line ? (
          <Box key={line} color="ink.soft">
            {line}
          </Box>
        ) : null,
      )}
    </Stack>
  )
}

/** A section's content, or a line saying there is none. */
function OrNone({
  none,
  children,
}: {
  readonly none: string | false
  readonly children: ReactNode
}) {
  return none === false ? children : <None>{none}</None>
}

/** One flight record: what went wrong, every step, the timeline, the calls, and the failure page. */
export function RecordPage({ view }: { readonly view: RecordView | null }) {
  const runs = <Link to="/">Runs</Link>

  if (view === null)
    return (
      <Page crumbs={[runs, "Not found"]} title="No such record">
        <Empty
          title="No such record"
          hint={
            <>
              Records are pruned with their run; the latest 20 runs keep theirs.{" "}
              <Link to="/">See all runs</Link>
            </>
          }
        />
      </Page>
    )

  return <FoundRecord view={view} />
}

/** The run as it happened: the replay player, the steps and the waterfall, moving together. */
function RunReplay({ view }: { readonly view: RecordView }) {
  const playback = usePlayback(view.replay)
  const replayed = view.replay.videos.length > 0 || view.replay.frames.length > 0

  return (
    <>
      {replayed ? (
        <Section
          title="Replay"
          aside={
            <styled.span color="ink.muted" fontSize="1">
              {view.replay.videos.length > 0
                ? "Video of the run"
                : "No video kept: the step screenshots"}
            </styled.span>
          }
        >
          <RecordPlayer dir={view.dir} replay={view.replay} playback={playback} />
        </Section>
      ) : null}
      <Section title="Steps" count={view.steps.length} bare>
        <RecordSteps view={view} playback={replayed ? playback : undefined} />
      </Section>
      <Section title="Timeline" aside={<TimelineLegend />}>
        <OrNone none={view.timeline.items.length === 0 && "Nothing was timed in this run."}>
          <Waterfall
            timeline={view.timeline}
            {...(replayed && { playheadMs: playback.ms, onSeek: playback.seek })}
          />
        </OrNone>
      </Section>
    </>
  )
}

/** A record that was found: what went wrong, the run replayed, and what happened behind the app. */
function FoundRecord({ view }: { readonly view: RecordView }) {
  const runs = <Link to="/">Runs</Link>
  const { record } = view
  const logs = record.appLog.filter((log) => log.level === "error" || log.level === "warn")

  return (
    <Page
      crumbs={[runs, record.test]}
      title={record.test}
      detail={
        <HStack gap="2" flexWrap="wrap" mt="1">
          <StatusBadge status={record.status} />
          <Ident>{runName(view)}</Ident>
          <span>
            started <TimeAgo at={record.startedAt} />, took {duration(record.durationMs)}
          </span>
        </HStack>
      }
      actions={view.page ? <CopyPage text={view.page} /> : <KeyHint />}
    >
      <Problem record={record} />
      <RunReplay view={view} />
      <Section title="Provider calls" count={record.exchanges.length}>
        <OrNone none={record.exchanges.length === 0 && "No calls went through the proxy."}>
          <Calls exchanges={record.exchanges} />
        </OrNone>
      </Section>
      <Section title="Webhooks" count={record.deliveries.length}>
        <OrNone none={record.deliveries.length === 0 && "No webhook deliveries."}>
          <Deliveries deliveries={record.deliveries} />
        </OrNone>
      </Section>
      <Section title="Console" count={logs.length}>
        <OrNone none={logs.length === 0 && "No errors or warnings."}>
          <ConsoleLog logs={logs} />
        </OrNone>
      </Section>
      {view.screen ? (
        <Section title="Screen at failure">
          <Pre bg="surface.item">{view.screen}</Pre>
        </Section>
      ) : null}
      <Section title="Emulator state">
        <styled.details>
          <styled.summary
            cursor="pointer"
            color="ink.soft"
            mb="2"
            w="fit-content"
            _hover={{ color: "ink.strong" }}
          >
            What the providers held when the run ended
          </styled.summary>
          <Pre bg="surface.item">{view.state}</Pre>
        </styled.details>
      </Section>
      {view.page ? (
        <Section title="Failure page" aside={<CopyPage text={view.page} />}>
          <Item px={{ base: "5", md: "8" }} py="6">
            <Box maxW="52rem">
              <MarkdownDocument text={view.page} />
            </Box>
          </Item>
        </Section>
      ) : null}
    </Page>
  )
}
