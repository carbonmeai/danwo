import { Box, Grid, HStack, styled } from "@danwo/ui/jsx"

import { duration } from "../../lib/format.ts"
import { type Lane, lanesOf, type Timeline, type TimelineItem } from "./record-timeline.ts"
import { statusColor } from "./record-values.ts"

const KIND_WORDS = { step: "Step", call: "Call", webhook: "Webhook" } as const

function KindMark({ kind }: { readonly kind: TimelineItem["kind"] }) {
  return (
    <styled.span
      fontSize="1"
      color={kind === "step" ? "ink.strong" : "ink.muted"}
      fontWeight="500"
      w="4.5rem"
      flexShrink="0"
    >
      {KIND_WORDS[kind]}
    </styled.span>
  )
}

/** Each kind's bar colour: steps grey, calls blue, webhooks aqua. */
const BAR_FILL = {
  step: "series.other",
  call: "series.1",
  webhook: "series.3",
} as const

/** One call, webhook or step on the waterfall's track, with a diamond where a fault landed. */
function Bar({ item, span }: { readonly item: TimelineItem; readonly span: number }) {
  return (
    <>
      <Box
        position="absolute"
        top={item.kind === "step" ? "0" : "1"}
        bottom={item.kind === "step" ? "0" : "1"}
        rounded="2px"
        bg={item.bad ? "verdict.failed.solid" : BAR_FILL[item.kind]}
        style={{
          left: `${(item.startMs / span) * 100}%`,
          width: `max(3px, ${(item.durationMs / span) * 100}%)`,
        }}
      />
      {item.fault ? (
        <Box
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
      <styled.span
        {...LABEL_STYLE[lane.kind]}
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {lane.label}
      </styled.span>
      {lane.items.length > 1 ? (
        <styled.span color="ink.muted" fontSize="1" flexShrink="0">
          ×{lane.items.length}
        </styled.span>
      ) : null}
    </HStack>
  )
}

/** One row of the waterfall: its label, its bars on the shared clock, and how it ended. */
function LaneRow({
  lane,
  first,
  span,
}: {
  readonly lane: Lane
  readonly first: boolean
  readonly span: number
}) {
  const faults = lane.items.flatMap((item) => (item.fault ? [item.fault] : []))
  const end = laneEnd(lane)

  return (
    <Grid
      as="li"
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
          <Bar key={j} item={item} span={span} />
        ))}
      </Box>
      <styled.span
        fontSize="1"
        fontWeight="500"
        textAlign="right"
        color={end.color}
        whiteSpace="nowrap"
      >
        {end.text}
      </styled.span>
    </Grid>
  )
}

/** Steps, provider calls and webhooks on one clock, with faults marked where they landed. */
export function Waterfall({ timeline }: { readonly timeline: Timeline }) {
  const span = Math.max(timeline.spanMs, 1)

  return (
    <Box bg="surface.item" rounded="10px" p="4" overflowX="auto">
      <Box minW="44rem">
        <Grid gridTemplateColumns={LANE_COLUMNS} columnGap="4" alignItems="center">
          <Box />
          <Box position="relative" h="5" color="ink.faint" fontSize="1">
            {TICKS.map((tick) => (
              <styled.span
                key={tick}
                position="absolute"
                whiteSpace="nowrap"
                style={{
                  left: `${tick * 100}%`,
                  transform: `translateX(${TICK_SHIFT[tick] ?? "-50%"})`,
                }}
              >
                {duration(tick * span)}
              </styled.span>
            ))}
          </Box>
          <Box />
        </Grid>
        <styled.ol aria-label="Timeline">
          {lanesOf(timeline.items).map((lane, i) => (
            <LaneRow key={`${lane.kind}-${i}`} lane={lane} first={i === 0} span={span} />
          ))}
        </styled.ol>
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
      as="ul"
      aria-label="Timeline legend"
      gap="3.5"
      fontSize="1"
      color="ink.soft"
      flexWrap="wrap"
    >
      {entries.map(([label, color]) => (
        <HStack as="li" key={label} gap="1.5">
          <Box w="2" h="2" rounded="2px" bg={color} />
          {label}
        </HStack>
      ))}
      <HStack as="li" gap="1.5">
        <Box w="2" h="2" bg="verdict.failed.solid" transform="rotate(45deg)" />
        Fault
      </HStack>
    </HStack>
  )
}
