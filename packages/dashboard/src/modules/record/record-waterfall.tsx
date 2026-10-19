import { Box, Grid, HStack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span } from "@danwo/ui/primitives/typography"

import { duration } from "../../lib/format.ts"
import { type Lane, lanesOf, type Timeline, type TimelineItem } from "./record-timeline.ts"
import { statusColor } from "./record-values.ts"

const KIND_WORDS = { step: "Step", call: "Call", webhook: "Webhook" } as const

function KindMark({ kind }: { readonly kind: TimelineItem["kind"] }) {
  return (
    <Span
      fontSize="1"
      color={kind === "step" ? "ink.strong" : "ink.muted"}
      fontWeight="500"
      w="4.5rem"
      flexShrink="0"
    >
      {KIND_WORDS[kind]}
    </Span>
  )
}

/** Each kind's bar colour: steps grey, calls blue, webhooks aqua. */
const BAR_FILL = {
  step: "series.other",
  call: "series.1",
  webhook: "series.3",
} as const

/** What the waterfall does with the replay player: where it is, and seeking it to a bar. */
export interface WaterfallPlayer {
  readonly playheadMs?: number
  readonly onSeek?: (ms: number) => void
}

/** A bar's words for a screen reader, when clicking it seeks the player. */
function seekLabel(item: TimelineItem): string {
  return `Go to ${KIND_WORDS[item.kind].toLowerCase()} ${item.label}${item.fault ? `, fault: ${item.fault}` : ""}`
}

/** One call, webhook or step on the waterfall's track, with a diamond where a fault landed. */
function Bar({
  item,
  span,
  onSeek,
}: {
  readonly item: TimelineItem
  readonly span: number
  readonly onSeek?: ((ms: number) => void) | undefined
}) {
  const place = {
    left: `${(item.startMs / span) * 100}%`,
    width: `max(3px, ${(item.durationMs / span) * 100}%)`,
  }
  const fill = (
    <Box
      position="absolute"
      inset="0"
      rounded="2px"
      bg={item.bad ? "verdict.failed.solid" : BAR_FILL[item.kind]}
    />
  )

  return (
    <>
      {onSeek ? (
        <Button
          variant="transparent"
          size="xs"
          position="absolute"
          top={item.kind === "step" ? "0" : "1"}
          bottom={item.kind === "step" ? "0" : "1"}
          h="auto"
          minW="0"
          px="0"
          rounded="2px"
          aria-label={seekLabel(item)}
          tooltipChildren={seekLabel(item)}
          style={place}
          onClick={() => onSeek(item.startMs)}
        >
          {fill}
        </Button>
      ) : (
        <Box
          position="absolute"
          top={item.kind === "step" ? "0" : "1"}
          bottom={item.kind === "step" ? "0" : "1"}
          style={place}
        >
          {fill}
        </Box>
      )}
      {item.fault ? (
        <Box
          {...(onSeek && { cursor: "pointer", onClick: () => onSeek(item.startMs) })}
          position="absolute"
          top="50%"
          w="2.5"
          h="2.5"
          bg="verdict.failed.solid"
          borderWidth="2px"
          borderColor="surface.item"
          aria-label={`Fault: ${item.fault}`}
          role="img"
          style={{
            left: `${(item.startMs / span) * 100}%`,
            transform: "translate(-50%, -50%) rotate(45deg)",
          }}
        />
      ) : null}
    </>
  )
}

const TICKS = [0, 0.25, 0.5, 0.75, 1]
const TICK_SHIFT: Readonly<Record<number, string>> = { 0: "0", 1: "-100%" }
const LANE_COLUMNS = "minmax(16rem, 2fr) minmax(0, 5fr) 5rem"

/** How a lane's label is set: steps in the text face, calls and webhooks indented in mono. */
const LABEL_STYLE = {
  step: { fontFamily: "sans", fontSize: "1.5", fontWeight: "500" },
  call: { fontFamily: "mono", fontSize: "1", fontWeight: "400" },
  webhook: { fontFamily: "mono", fontSize: "1", fontWeight: "400" },
} as const

/** What a lane's right-hand column says: a step's time, or the worst status among its calls. */
function laneEnd(lane: Lane): { readonly text: string; readonly color: string } {
  const shown = lane.items.find((item) => item.bad) ?? lane.items[0]

  if (shown === undefined) return { text: "", color: "ink.muted" }

  return {
    text: lane.kind === "step" ? duration(shown.durationMs) : shown.outcome,
    color: statusColor(shown),
  }
}

function LaneLabel({ lane }: { readonly lane: Lane }) {
  return (
    <HStack gap="2" minW="0" pl={lane.kind === "step" ? "0" : "3"}>
      <KindMark kind={lane.kind} />
      <Span
        {...LABEL_STYLE[lane.kind]}
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {lane.label}
      </Span>
      {lane.items.length > 1 ? (
        <Span color="ink.muted" fontSize="1" flexShrink="0">
          ×{lane.items.length}
        </Span>
      ) : null}
    </HStack>
  )
}

/** One row of the waterfall: its label, its bars on the shared clock, and how it ended. */
function LaneRow({
  lane,
  first,
  span,
  player,
}: {
  readonly lane: Lane
  readonly first: boolean
  readonly span: number
  readonly player: WaterfallPlayer
}) {
  const faults = lane.items.flatMap((item) => (item.fault ? [item.fault] : []))
  const end = laneEnd(lane)

  return (
    <Grid
      role="listitem"
      gridTemplateColumns={LANE_COLUMNS}
      columnGap="4"
      alignItems="center"
      py="1"
      mt={lane.kind === "step" && !first ? "1.5" : "0"}
      data-kind={lane.kind}
      title={faults.length > 0 ? `Fault: ${faults.join(", ")}` : lane.label}
    >
      <LaneLabel lane={lane} />
      <Box position="relative" h="4" bg="surface.panel" rounded="4px">
        {TICKS.slice(1, -1).map((tick) => (
          <Box
            key={tick}
            position="absolute"
            top="0"
            bottom="0"
            w="1px"
            bg="hairline"
            style={{ left: `${tick * 100}%` }}
          />
        ))}
        {lane.items.map((item, j) => (
          <Bar key={j} item={item} span={span} onSeek={player.onSeek} />
        ))}
        <Playhead ms={player.playheadMs} span={span} />
      </Box>
      <Span fontSize="1" fontWeight="500" textAlign="right" color={end.color} whiteSpace="nowrap">
        {end.text}
      </Span>
    </Grid>
  )
}

/** Where the replay player is, as a line down a track; nothing without a player. */
function Playhead({ ms, span }: { readonly ms: number | undefined; readonly span: number }) {
  if (ms === undefined || ms < 0 || ms > span) return null

  return (
    <Box
      position="absolute"
      top="-1"
      bottom="-1"
      w="2px"
      bg="series.1"
      pointerEvents="none"
      data-playhead
      style={{ left: `${(ms / span) * 100}%`, transform: "translateX(-50%)" }}
    />
  )
}

/**
 * Steps, provider calls and webhooks on one clock, with faults marked where they landed. With a
 * replay player, a line follows where it is and clicking a bar seeks it there.
 */
export function Waterfall({
  timeline,
  ...player
}: { readonly timeline: Timeline } & WaterfallPlayer) {
  const span = Math.max(timeline.spanMs, 1)

  return (
    <Box bg="surface.item" rounded="10px" p="4" h="full" minH="0" overflow="auto">
      <Box minW="44rem">
        <Grid gridTemplateColumns={LANE_COLUMNS} columnGap="4" alignItems="center">
          <Box />
          <Box position="relative" h="5" color="ink.faint" fontSize="1">
            {TICKS.map((tick) => (
              <Span
                key={tick}
                position="absolute"
                whiteSpace="nowrap"
                style={{
                  left: `${tick * 100}%`,
                  transform: `translateX(${TICK_SHIFT[tick] ?? "-50%"})`,
                }}
              >
                {duration(tick * span)}
              </Span>
            ))}
          </Box>
          <Box />
        </Grid>
        <Box role="list" aria-label="Timeline">
          {lanesOf(timeline.items).map((lane, i) => (
            <LaneRow
              key={`${lane.kind}-${i}`}
              lane={lane}
              first={i === 0}
              span={span}
              player={player}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** What the waterfall's colours and marks mean. */
export function TimelineLegend() {
  const entries: readonly (readonly [string, string])[] = [
    ["Step", "series.other"],
    ["Provider call", "series.1"],
    ["Webhook", "series.3"],
    ["Failed", "verdict.failed.solid"],
  ]

  return (
    <HStack
      role="list"
      aria-label="Timeline legend"
      gap="3.5"
      fontSize="1"
      color="ink.soft"
      flexWrap="wrap"
    >
      {entries.map(([label, color]) => (
        <HStack role="listitem" key={label} gap="1.5">
          <Box w="2" h="2" rounded="2px" bg={color} />
          {label}
        </HStack>
      ))}
      <HStack role="listitem" gap="1.5">
        <Box w="2" h="2" bg="verdict.failed.solid" transform="rotate(45deg)" />
        Fault
      </HStack>
    </HStack>
  )
}
