import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useState } from "react"

import { Ident, Pre } from "../../components/code.tsx"
import { Button, SegmentTrack, segment } from "../../components/controls.tsx"
import { useCopied } from "../../components/copy-link.tsx"
import { None } from "../../components/panel.tsx"
import { RowTable, Td, Th } from "../../components/table.tsx"
import { duration } from "../../lib/format.ts"
import { Calls, Deliveries } from "../record/record-calls.tsx"
import type { RecordView } from "../record/record-data.ts"
import { RecordPlayer } from "../record/record-player.tsx"
import { clock } from "../record/record-replay.ts"
import { LEVEL_COLOR, SEEN } from "../record/record-values.ts"
import { TimelineLegend, Waterfall } from "../record/record-waterfall.tsx"
import type { Playback } from "../record/use-playback.ts"
import {
  CONSOLE_LEVELS,
  type ConsoleLevel,
  LEVEL_WORDS,
  consoleLines,
  networkRows,
  shownRows,
} from "./overlay-values.ts"

/** The tabs of the overlay's right pane. */
export const PANES = [
  "replay",
  "console",
  "network",
  "providers",
  "state",
  "effects",
  "matrix",
] as const

export type Pane = (typeof PANES)[number]

export const PANE_WORDS: Readonly<Record<Pane, string>> = {
  replay: "Replay",
  console: "Console",
  network: "Network",
  providers: "Providers",
  state: "Emulator state",
  effects: "Effects",
  matrix: "Matrix",
}

export interface PaneProps {
  readonly view: RecordView
  readonly playback: Playback | undefined
}

const Filter = styled("input", {
  base: {
    h: "8",
    px: "2.5",
    w: { base: "full", sm: "16rem" },
    rounded: "lg",
    bg: "surface.hover",
    color: "ink.strong",
    fontSize: "1",
    outline: "none",
    _placeholder: { color: "ink.faint" },
    _focus: { boxShadow: "0 0 0 3px {colors.ring}" },
  },
})

/** The run's video full size, the scrubber under it with every step and fault marked. */
export function ReplayPane({ view, playback }: PaneProps) {
  if (playback === undefined) return <None>This run kept no video or screenshots to replay.</None>

  return <RecordPlayer dir={view.dir} replay={view.replay} playback={playback} />
}

/** The app's console by level, filtered by what is typed, ready to copy. */
export function ConsolePane({ view }: PaneProps) {
  const [level, setLevel] = useState<ConsoleLevel>("all")
  const [filter, setFilter] = useState("")
  const [copied, copy] = useCopied()
  const lines = consoleLines(view.record.appLog, level, filter)

  return (
    <Stack gap="3" minH="0">
      <HStack gap="2" flexWrap="wrap">
        <SegmentTrack role="tablist" aria-label="Log level">
          {CONSOLE_LEVELS.map((each) => (
            <styled.button
              key={each}
              type="button"
              className={segment}
              role="tab"
              aria-selected={each === level}
              data-on={each === level || undefined}
              onClick={() => setLevel(each)}
            >
              {LEVEL_WORDS[each]}
            </styled.button>
          ))}
        </SegmentTrack>
        <Filter
          type="search"
          placeholder="Filter the console"
          aria-label="Filter the console"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Button
          type="button"
          ml="auto"
          onClick={() => copy(lines.map((line) => `${line.level} ${line.text}`).join("\n"))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
      {lines.length === 0 ? (
        <None>Nothing logged at this level.</None>
      ) : (
        <Pre bg="surface.item">
          {lines.map((line, i) => (
            <styled.span key={i} display="block" color={LEVEL_COLOR[line.level]}>
              {`step ${line.step + 1}  ${line.level.padEnd(5)}  ${line.text}`}
            </styled.span>
          ))}
        </Pre>
      )}
    </Stack>
  )
}

/** Every call the app's browser and server made through the proxy, as a table. */
export function NetworkPane({ view }: PaneProps) {
  const [filter, setFilter] = useState("")
  const [assets, setAssets] = useState(false)
  const rows = shownRows(networkRows(view.record), filter, assets)

  return (
    <Stack gap="3" minH="0">
      <HStack gap="3" flexWrap="wrap">
        <Filter
          type="search"
          placeholder="Filter by method, status or URL"
          aria-label="Filter the network"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <styled.label
          display="inline-flex"
          alignItems="center"
          gap="1.5"
          color="ink.soft"
          fontSize="1"
        >
          <input
            type="checkbox"
            checked={assets}
            onChange={(event) => setAssets(event.target.checked)}
          />
          Show static assets
        </styled.label>
      </HStack>
      {rows.length === 0 ? (
        <None>No calls went through the proxy{assets ? "" : " besides static assets"}.</None>
      ) : (
        <Box overflowX="auto">
          <RowTable aria-label="Network">
            <thead>
              <tr>
                {["Time", "Name", "Status", "Method", "Type", "Initiator", "Took", "URL"].map(
                  (head) => (
                    <Th key={head}>{head}</Th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td fontVariantNumeric="tabular-nums">{clock(row.atMs)}</Td>
                  <Td fontWeight="500">{row.name}</Td>
                  <Td
                    color={
                      row.fault || row.status.startsWith("5") ? "verdict.failed.fg" : undefined
                    }
                  >
                    {row.status}
                    {row.fault ? <styled.span ml="1.5">· {row.fault}</styled.span> : null}
                  </Td>
                  <Td>{row.method}</Td>
                  <Td color="ink.muted">{row.type}</Td>
                  <Td color="ink.muted">{row.initiator}</Td>
                  <Td color="ink.muted" whiteSpace="nowrap">
                    {row.durationMs === null ? "–" : duration(row.durationMs)}
                  </Td>
                  <Td maxW="28rem">
                    <Ident
                      display="block"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                      title={row.url}
                    >
                      {row.url}
                    </Ident>
                  </Td>
                </tr>
              ))}
            </tbody>
          </RowTable>
        </Box>
      )}
    </Stack>
  )
}

/** Steps, provider calls and webhooks on one clock with the faults marked, then the webhooks. */
export function ProvidersPane({ view, playback }: PaneProps) {
  return (
    <Stack gap="4">
      <HStack justify="flex-end">
        <TimelineLegend />
      </HStack>
      {view.timeline.items.length === 0 ? (
        <None>Nothing was timed in this run.</None>
      ) : (
        <Waterfall
          timeline={view.timeline}
          {...(playback && { playheadMs: playback.ms, onSeek: playback.seek })}
        />
      )}
      {view.record.exchanges.length > 0 ? <Calls exchanges={view.record.exchanges} /> : null}
      {view.record.deliveries.length > 0 ? (
        <Deliveries deliveries={view.record.deliveries} />
      ) : null}
    </Stack>
  )
}

/** What each emulated provider held when the run ended: what an invariant reads. */
export function StatePane({ view }: PaneProps) {
  return <Pre bg="surface.item">{view.state}</Pre>
}

/** For each step that compared them, what the recording expected against what this run did. */
export function EffectsPane({ view }: PaneProps) {
  const compared = view.steps.filter(
    (step) => step.effectDiff !== undefined && step.effectDiff.length > 0,
  )

  if (compared.length === 0)
    return (
      <None>
        No step compared its effects: a step compares what it changed on the page and behind it once
        it replays from a recording.
      </None>
    )

  return (
    <Stack gap="4">
      {compared.map((step) => (
        <Stack key={step.index} gap="1.5">
          <styled.h3 fontWeight="600">
            {step.index + 1}. {step.label}
          </styled.h3>
          <Pre bg="surface.item">
            {(step.effectDiff ?? []).map((line, i) => (
              <styled.span key={i} display="block" color={SEEN[line.seen].color}>
                {`${SEEN[line.seen].mark} ${line.area.padEnd(8)} ${line.text}   (${SEEN[line.seen].word})`}
              </styled.span>
            ))}
          </Pre>
        </Stack>
      ))}
    </Stack>
  )
}

/** The fault a matrix trial ran under, and what the invariant made of the run after it. */
export function MatrixPane({ view }: PaneProps) {
  const { run } = view.record

  if (run.kind !== "matrix") return <None>This run was not a matrix trial.</None>

  return (
    <Stack gap="2">
      <styled.p>
        {run.fault ? (
          <>
            This run replayed the clean recording with one fault injected:{" "}
            <Ident>{run.fault.label}</Ident>.
          </>
        ) : (
          "This was the matrix's clean run: the recording every faulted trial replays."
        )}
      </styled.p>
      {view.record.stopped ? <styled.p color="ink.soft">{view.record.stopped}</styled.p> : null}
      {view.record.notes.map((note) => (
        <styled.p key={note} color="ink.muted">
          {note}
        </styled.p>
      ))}
    </Stack>
  )
}
