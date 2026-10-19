import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Checkbox } from "@danwo/ui/primitives/checkbox/checkbox"
import { Label } from "@danwo/ui/primitives/label"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@danwo/ui/primitives/resizable"
import { TableBody, TableCell, TableHead, TableRow } from "@danwo/ui/primitives/table"
import { TabTrigger, Tabs, TabsList } from "@danwo/ui/primitives/tabs"
import { Heading, Span, Text } from "@danwo/ui/primitives/typography"
import { useState } from "react"

import { Ident, Pre } from "../../components/code.tsx"
import { SearchBox } from "../../components/controls.tsx"
import { useCopied } from "../../components/copy-link.tsx"
import { None } from "../../components/panel.tsx"
import { ScrollTable } from "../../components/scroll-table.tsx"
import { duration } from "../../lib/format.ts"
import { CallDetail, CallsTable, DeliveriesTable, NoneHere } from "../record/record-calls.tsx"
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

/**
 * A pane that fills the overlay's right side: a toolbar on top, and beneath it a region that
 * scrolls on its own or holds a table that does.
 */
function PaneFrame({
  bar,
  children,
}: {
  readonly bar?: React.ReactNode
  readonly children: React.ReactNode
}) {
  return (
    <Stack gap="3" h="full" minH="0">
      {bar === undefined ? null : (
        <HStack gap="2" flexWrap="wrap" flexShrink="0">
          {bar}
        </HStack>
      )}
      <Box flex="1" minH="0">
        {children}
      </Box>
    </Stack>
  )
}

/** The run's video full size, the scrubber under it with every step and fault marked. */
export function ReplayPane({ view, playback }: PaneProps) {
  if (playback === undefined) return <None>This run kept no video or screenshots to replay.</None>

  return (
    <Box h="full" minH="0" overflowY="auto">
      <RecordPlayer dir={view.dir} replay={view.replay} playback={playback} />
    </Box>
  )
}

/** The app's console by level, filtered by what is typed, ready to copy. */
export function ConsolePane({ view }: PaneProps) {
  const [level, setLevel] = useState<ConsoleLevel>("all")
  const [filter, setFilter] = useState("")
  const [, copy] = useCopied("Console copied")
  const lines = consoleLines(view.record.appLog, level, filter)

  return (
    <PaneFrame
      bar={
        <>
          <Tabs value={level} onValueChange={(next) => setLevel(next as ConsoleLevel)}>
            <TabsList aria-label="Log level">
              {CONSOLE_LEVELS.map((each) => (
                <TabTrigger key={each} value={each}>
                  {LEVEL_WORDS[each]}
                </TabTrigger>
              ))}
            </TabsList>
          </Tabs>
          <SearchBox
            label="Filter the console"
            placeholder="Filter the console"
            value={filter}
            onChange={setFilter}
          />
          <Button
            variant="soft"
            size="sm"
            ml="auto"
            onClick={() => copy(lines.map((line) => `${line.level} ${line.text}`).join("\n"))}
          >
            <Icons.copy size={13} />
            Copy
          </Button>
        </>
      }
    >
      {lines.length === 0 ? (
        <NoneHere>Nothing logged at this level.</NoneHere>
      ) : (
        <ScrollTable
          label="Console"
          head={
            <TableRow _hover={{ bg: "transparent" }}>
              <TableHead px="3" color="ink.muted" w="5rem">
                Step
              </TableHead>
              <TableHead px="3" color="ink.muted" w="5rem">
                Level
              </TableHead>
              <TableHead px="3" color="ink.muted">
                Message
              </TableHead>
            </TableRow>
          }
        >
          <TableBody>
            {lines.map((line, i) => (
              <TableRow key={i}>
                <TableCell px="3" color="ink.muted" fontSize="1" verticalAlign="top">
                  {line.step + 1}
                </TableCell>
                <TableCell
                  px="3"
                  fontFamily="mono"
                  fontSize="1"
                  color={LEVEL_COLOR[line.level]}
                  verticalAlign="top"
                >
                  {line.level}
                </TableCell>
                <TableCell
                  px="3"
                  fontFamily="mono"
                  fontSize="1"
                  whiteSpace="pre-wrap"
                  overflowWrap="anywhere"
                  color={LEVEL_COLOR[line.level]}
                >
                  {line.text}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
      )}
    </PaneFrame>
  )
}

/** Every call the app's browser and server made through the proxy, as a table. */
export function NetworkPane({ view }: PaneProps) {
  const [filter, setFilter] = useState("")
  const [assets, setAssets] = useState(false)
  const rows = shownRows(networkRows(view.record), filter, assets)

  return (
    <PaneFrame
      bar={
        <>
          <SearchBox
            label="Filter the network"
            placeholder="Filter by method, status or URL"
            value={filter}
            onChange={setFilter}
            width="18rem"
          />
          <HStack gap="2">
            <Checkbox
              id="network-assets"
              checked={assets}
              onCheckedChange={(checked) => setAssets(checked === true)}
            />
            <Label htmlFor="network-assets" fontSize="1" color="ink.soft">
              Show static assets
            </Label>
          </HStack>
        </>
      }
    >
      {rows.length === 0 ? (
        <NoneHere>{`No calls went through the proxy${assets ? "" : " besides static assets"}.`}</NoneHere>
      ) : (
        <ScrollTable
          label="Network"
          head={
            <TableRow _hover={{ bg: "transparent" }}>
              {["Time", "Name", "Status", "Method", "Type", "Initiator", "Took", "URL"].map(
                (head) => (
                  <TableHead key={head} px="3" color="ink.muted">
                    {head}
                  </TableHead>
                ),
              )}
            </TableRow>
          }
        >
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell px="3" fontVariantNumeric="tabular-nums" color="ink.muted">
                  {clock(row.atMs)}
                </TableCell>
                <TableCell px="3" fontWeight="500">
                  {row.name}
                </TableCell>
                <TableCell
                  px="3"
                  color={row.fault || row.status.startsWith("5") ? "verdict.failed.fg" : undefined}
                >
                  {row.status}
                  {row.fault ? <Span ml="1.5">· {row.fault}</Span> : null}
                </TableCell>
                <TableCell px="3" fontFamily="mono" fontSize="1">
                  {row.method}
                </TableCell>
                <TableCell px="3" color="ink.muted">
                  {row.type}
                </TableCell>
                <TableCell px="3" color="ink.muted">
                  {row.initiator}
                </TableCell>
                <TableCell px="3" color="ink.muted">
                  {row.durationMs === null ? "–" : duration(row.durationMs)}
                </TableCell>
                <TableCell px="3" maxW="28rem">
                  <Ident
                    display="block"
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    title={row.url}
                  >
                    {row.url}
                  </Ident>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
      )}
    </PaneFrame>
  )
}

/** The calls as a table, the picked one's request and response beside it (below on narrow screens). */
function CallsArea({ exchanges }: { readonly exchanges: RecordView["record"]["exchanges"] }) {
  const [picked, setPicked] = useState<string>()
  const call = exchanges.find((exchange) => exchange.id === picked)

  if (exchanges.length === 0) return <NoneHere>No provider calls in this run.</NoneHere>

  return (
    <Grid
      h="full"
      minH="0"
      gap="2"
      gridTemplateColumns={call ? { base: "1fr", xl: "minmax(0, 1fr) 24rem" } : "1fr"}
      gridTemplateRows={
        call ? { base: "minmax(0, 1fr) minmax(0, 1fr)", xl: "minmax(0, 1fr)" } : "minmax(0, 1fr)"
      }
    >
      <CallsTable exchanges={exchanges} picked={picked} onPick={setPicked} />
      {call ? <CallDetail exchange={call} onClose={() => setPicked(undefined)} /> : null}
    </Grid>
  )
}

/** The calls and webhooks under the waterfall, one table at a time behind the library's tabs. */
function ProviderTables({ view }: { readonly view: RecordView }) {
  const { exchanges, deliveries } = view.record
  const [table, setTable] = useState<"calls" | "webhooks">("calls")

  return (
    <Stack gap="2" h="full" minH="0" pt="3">
      <Tabs value={table} onValueChange={(next) => setTable(next as "calls" | "webhooks")}>
        <TabsList aria-label="Calls or webhooks">
          <TabTrigger value="calls" gap="1.5">
            Calls
            <Span color="ink.muted">{exchanges.length}</Span>
          </TabTrigger>
          <TabTrigger value="webhooks" gap="1.5">
            Webhooks
            <Span color="ink.muted">{deliveries.length}</Span>
          </TabTrigger>
        </TabsList>
      </Tabs>
      <Box flex="1" minH="0">
        {table === "calls" ? (
          <CallsArea exchanges={exchanges} />
        ) : deliveries.length === 0 ? (
          <NoneHere>No webhooks were delivered in this run.</NoneHere>
        ) : (
          <DeliveriesTable deliveries={deliveries} />
        )}
      </Box>
    </Stack>
  )
}

/**
 * Steps, provider calls and webhooks on one clock with the faults marked, held at the top; the
 * calls and webhooks as tables beneath, each in its own scroll region, with a handle between.
 */
export function ProvidersPane({ view, playback }: PaneProps) {
  return (
    <PaneFrame bar={<TimelineLegend />}>
      <ResizablePanelGroup direction="vertical" autoSaveId="danwo-providers">
        <ResizablePanel defaultSize="45" minSize="15">
          {view.timeline.items.length === 0 ? (
            <NoneHere>Nothing was timed in this run.</NoneHere>
          ) : (
            <Waterfall
              timeline={view.timeline}
              {...(playback && { playheadMs: playback.ms, onSeek: playback.seek })}
            />
          )}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="55" minSize="20">
          <ProviderTables view={view} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </PaneFrame>
  )
}

/** What each emulated provider held when the run ended: what an invariant reads. */
export function StatePane({ view }: PaneProps) {
  return (
    <Pre bg="surface.item" h="full" maxH="none" overflow="auto" m="0">
      {view.state}
    </Pre>
  )
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
    <Stack gap="4" h="full" minH="0" overflowY="auto">
      {compared.map((step) => (
        <Stack key={step.index} gap="1.5">
          <Heading as="h3" fontWeight="600">
            {step.index + 1}. {step.label}
          </Heading>
          <Pre bg="surface.item">
            {(step.effectDiff ?? []).map((line, i) => (
              <Span key={i} display="block" color={SEEN[line.seen].color}>
                {`${SEEN[line.seen].mark} ${line.area.padEnd(8)} ${line.text}   (${SEEN[line.seen].word})`}
              </Span>
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
    <Stack gap="2" h="full" minH="0" overflowY="auto">
      <Text>
        {run.fault ? (
          <>
            This run replayed the clean recording with one fault injected:{" "}
            <Ident>{run.fault.label}</Ident>.
          </>
        ) : (
          "This was the matrix's clean run: the recording every faulted trial replays."
        )}
      </Text>
      {view.record.stopped ? <Text color="ink.soft">{view.record.stopped}</Text> : null}
      {view.record.notes.map((note) => (
        <Text key={note} color="ink.muted">
          {note}
        </Text>
      ))}
    </Stack>
  )
}
