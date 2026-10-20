import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { ButtonGroup } from "@danwo/ui/primitives/button-group"
import { Span } from "@danwo/ui/primitives/typography"
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react"

import { useCopied } from "../../components/copy-link.tsx"
import {
  clock,
  frameAt,
  type Replay,
  type ReplayMark,
  type ReplaySegment,
  type ReplayTabMark,
  type ReplayVideo,
  stepAt,
  videoName,
} from "./record-replay.ts"
import { type Playback, TAIL_RATE } from "./use-playback.ts"
import { useScreenshot } from "./use-screenshot.ts"

const RATES = [0.5, 1, 2, 4] as const

/** Where `ms` falls along the scrubber's span, from 0 to 1. */
function shareOf(playback: Playback, ms: number): number {
  const span = Math.max(playback.endMs - playback.startMs, 1)

  return Math.min(Math.max((ms - playback.startMs) / span, 0), 1)
}

/** A fraction of the scrubber's span, as a CSS percentage. */
function at(playback: Playback, ms: number): string {
  return `${shareOf(playback, ms) * 100}%`
}

/** The tint of a segment: settling as work still going, checks as how they went. */
function segmentTint(segment: ReplaySegment): string {
  if (segment.bad) return "verdict.failed.bg"

  return segment.phase === "settle" ? "verdict.notJudged.bg" : "verdict.passed.bg"
}

/** A shaded, labelled stretch of the scrubber: the wait for background work, or the checks. */
function SegmentShade({
  segment,
  playback,
}: {
  readonly segment: ReplaySegment
  readonly playback: Playback
}) {
  const width = shareOf(playback, segment.endMs) - shareOf(playback, segment.atMs)

  return (
    <Box
      position="absolute"
      top="0"
      bottom="0"
      display="flex"
      alignItems="center"
      overflow="hidden"
      rounded="4px"
      bg={segmentTint(segment)}
      pointerEvents="none"
      aria-hidden
      style={{ left: at(playback, segment.atMs), width: `${width * 100}%` }}
    >
      <Span px="1" fontSize="0.625" fontWeight="600" color="ink.muted" truncate>
        {segment.label.toLowerCase()}
      </Span>
    </Box>
  )
}

/** A step's tick on the scrubber, red when it did not pass. */
function StepTick({ mark, playback }: { readonly mark: ReplayMark; readonly playback: Playback }) {
  return (
    <Box
      position="absolute"
      top="0"
      bottom="0"
      w="2px"
      rounded="1px"
      bg={mark.bad ? "verdict.failed.solid" : "ink.faint"}
      style={{ left: at(playback, mark.atMs) }}
      title={`Step ${mark.step ?? ""}: ${mark.label}`}
    />
  )
}

/** A fault's diamond on the scrubber. */
function FaultMark({ mark, playback }: { readonly mark: ReplayMark; readonly playback: Playback }) {
  return (
    <Box
      position="absolute"
      top="50%"
      w="2.5"
      h="2.5"
      bg="verdict.failed.solid"
      borderWidth="2px"
      borderColor="surface.item"
      role="img"
      aria-label={`Fault: ${mark.fault ?? ""} on ${mark.label}`}
      style={{
        left: at(playback, mark.atMs),
        transform: "translate(-50%, -50%) rotate(45deg)",
      }}
    />
  )
}

/** A flag where a popup opened or the run came back from it; clicking it shows that tab there. */
function TabFlag({
  mark,
  playback,
}: {
  readonly mark: ReplayTabMark
  readonly playback: Playback
}) {
  if (mark.atMs < playback.startMs || mark.atMs > playback.endMs) return null

  return (
    <Box
      position="absolute"
      top="-1"
      w="2"
      h="2"
      rounded="full"
      bg={mark.kind === "opened" ? "series.2" : "ink.faint"}
      borderWidth="2px"
      borderColor="surface.item"
      role="img"
      aria-label={mark.label}
      title={mark.label}
      style={{ left: at(playback, mark.atMs), transform: "translateX(-50%)" }}
    />
  )
}

/** Where the pointer is along `track`, on the record's clock. */
function pointedMs(playback: Playback, track: HTMLElement, clientX: number): number {
  const box = track.getBoundingClientRect()
  const share = box.width === 0 ? 0 : (clientX - box.left) / box.width

  return playback.startMs + share * (playback.endMs - playback.startMs)
}

/** Keys a focused scrubber answers: arrows move a second (Shift: five), space plays. */
function scrubKeys(playback: Playback, event: KeyboardEvent<HTMLDivElement>): void {
  const step = event.shiftKey ? 5_000 : 1_000
  const moves: Readonly<Record<string, number>> = {
    ArrowLeft: playback.ms - step,
    ArrowRight: playback.ms + step,
    Home: playback.startMs,
    End: playback.endMs,
  }
  const to = moves[event.key]

  if (to !== undefined) playback.seek(to)
  else if (event.key === " ") playback.toggle()
  else return

  event.preventDefault()
}

/** The scrubber: the run's span with its steps and faults marked, dragged or clicked to seek. */
function Scrubber({ playback }: { readonly playback: Playback }) {
  const track = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    if (track.current) playback.seek(pointedMs(playback, track.current, event.clientX))
  }

  return (
    <Box
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round((playback.endMs - playback.startMs) / 100) / 10}
      aria-valuenow={Math.round((playback.ms - playback.startMs) / 100) / 10}
      aria-valuetext={clock(playback.ms - playback.startMs)}
      position="relative"
      flex="1"
      minW="8rem"
      h="5"
      cursor="pointer"
      outline="none"
      rounded="6px"
      _focusVisible={{ boxShadow: "0 0 0 3px {colors.ring}" }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        seekTo(event)
      }}
      onPointerMove={(event) => dragging && seekTo(event)}
      onPointerUp={() => setDragging(false)}
      onKeyDown={(event) => scrubKeys(playback, event)}
    >
      {playback.segments.map((segment) => (
        <SegmentShade key={segment.phase} segment={segment} playback={playback} />
      ))}
      <Box
        position="absolute"
        left="0"
        right="0"
        top="1.5"
        bottom="1.5"
        rounded="full"
        bg="surface.track"
      >
        <Box h="full" rounded="full" bg="series.1" style={{ width: at(playback, playback.ms) }} />
      </Box>
      {playback.marks.map((mark, i) =>
        mark.kind === "step" ? <StepTick key={`s${i}`} mark={mark} playback={playback} /> : null,
      )}
      {playback.marks.map((mark, i) =>
        mark.fault ? <FaultMark key={`f${i}`} mark={mark} playback={playback} /> : null,
      )}
      {playback.tabMarks.map((mark) => (
        <TabFlag key={`${mark.kind}-${mark.video}-${mark.atMs}`} mark={mark} playback={playback} />
      ))}
      <Box
        position="absolute"
        top="50%"
        w="3"
        h="3"
        rounded="full"
        bg="surface.chip"
        boxShadow="chip"
        pointerEvents="none"
        style={{
          left: at(playback, playback.ms),
          transform: "translate(-50%, -50%)",
        }}
      />
    </Box>
  )
}

/** The screen as a picture: the step screenshot showing at the player's moment. */
function Still({
  dir,
  replay,
  playback,
}: {
  readonly dir: string
  readonly replay: Replay
  readonly playback: Playback
}) {
  const frame = frameAt(replay.frames, playback.ms)
  const { src } = useScreenshot(dir, frame?.screenshot, false)

  if (frame === undefined)
    return (
      <HStack h="full" justify="center" color="ink.muted" fontSize="1.5">
        This run kept no video and no screenshots.
      </HStack>
    )

  return src ? (
    <styled.img
      src={src}
      alt={`Screen after step ${frame.step}`}
      w="full"
      h="full"
      objectFit="contain"
    />
  ) : null
}

/** Copies a link that opens this record with the player at this moment. */
function CopyMoment({ playback }: { readonly playback: Playback }) {
  const [copied, copy] = useCopied("Link to this moment copied")

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy a link to this moment"
      tooltipChildren="Copy a link to this moment"
      onClick={() => {
        const url = new URL(window.location.href)

        url.hash = ""
        url.searchParams.set("t", ((playback.ms - playback.startMs) / 1000).toFixed(1))
        copy(url.href)
      }}
    >
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copyLink size={14} />}
    </Button>
  )
}

/** A row of toggles as the library's button group, the chosen one pressed. */
function Toggles<T extends number>({
  label,
  values,
  chosen,
  words,
  onChoose,
}: {
  readonly label: string
  readonly values: readonly T[]
  readonly chosen: number
  readonly words: (value: T) => string
  readonly onChoose: (value: T) => void
}) {
  return (
    <ButtonGroup role="group" aria-label={label}>
      {values.map((value) => (
        <Button
          key={value}
          variant={value === chosen ? "solid" : "soft"}
          size="xs"
          aria-pressed={value === chosen}
          onClick={() => onChoose(value)}
        >
          {words(value)}
        </Button>
      ))}
    </ButtonGroup>
  )
}

/** Play or pause, the clock, the scrubber, the speed, and a link to the moment. */
function Controls({
  playback,
  videos,
}: {
  readonly playback: Playback
  readonly videos: readonly ReplayVideo[]
}) {
  return (
    <HStack gap="2" flexWrap="wrap" mt="2.5">
      <Button
        variant="solid"
        size="icon"
        aria-label={playback.playing ? "Pause" : "Play"}
        onClick={playback.toggle}
      >
        {playback.playing ? <Icons.pause size={14} /> : <Icons.play size={14} />}
      </Button>
      <Span
        fontSize="1"
        color="ink.soft"
        fontVariantNumeric="tabular-nums"
        minW="6.5rem"
        aria-live="off"
      >
        {clock(playback.ms - playback.startMs)} / {clock(playback.endMs - playback.startMs)}
      </Span>
      <Scrubber playback={playback} />
      <Toggles
        label="Speed"
        values={RATES}
        chosen={playback.rate}
        words={(rate) => `${rate}×`}
        onChoose={playback.setRate}
      />
      {playback.segments.length > 0 ? (
        <Button
          variant={playback.fastTail ? "solid" : "soft"}
          size="xs"
          aria-pressed={playback.fastTail}
          tooltipChildren={`Play settling and checks at ${TAIL_RATE}×, where the browser sits idle`}
          onClick={() => playback.setFastTail(!playback.fastTail)}
        >
          <Icons.fastForward size={12} />
          Idle at {TAIL_RATE}×
        </Button>
      ) : null}
      {videos.length > 1 ? (
        <Toggles
          label={videos.some((video) => video.user !== undefined) ? "Browser" : "Tab"}
          values={videos.map((_, i) => i)}
          chosen={playback.tab}
          words={(i) => videoName(videos, i)}
          onChoose={playback.pickTab}
        />
      ) : null}
      <CopyMoment playback={playback} />
    </HStack>
  )
}

/** A jump to where settling or the checks start. */
function GoToSegment({
  segment,
  playback,
}: {
  readonly segment: ReplaySegment
  readonly playback: Playback
}) {
  return (
    <Button
      variant="soft"
      size="xs"
      aria-label={`Go to ${segment.label.toLowerCase()}, at ${clock(segment.atMs - playback.startMs)}`}
      onClick={() => playback.seek(segment.atMs)}
    >
      <Icons.play size={10} />
      {segment.label}
    </Button>
  )
}

/** The tab the player shows, named when it is a popup: `In the popup: accounts.provider.test`. */
function PopupNote({ video }: { readonly video: ReplayVideo | undefined }) {
  if (video?.opener === undefined) return null

  return (
    <Span
      px="1.5"
      rounded="4px"
      bg="surface.hover"
      color="ink.soft"
      fontSize="1"
      fontWeight="600"
      flexShrink="0"
    >
      In the popup{video.host === undefined ? "" : `: ${video.host}`}
    </Span>
  )
}

/** What is happening at the player's moment: the step running, or settling and the checks. */
function NowLine({ playback }: { readonly playback: Playback }) {
  const index = stepAt(playback.marks, playback.ms)
  const step = playback.marks.find((mark) => mark.kind === "step" && mark.step === index)
  const segment = playback.segments.findLast((each) => playback.ms >= each.atMs)

  return (
    <HStack gap="2" mt="2" fontSize="1" color="ink.soft" minH="5" aria-live="polite">
      <PopupNote video={playback.video} />
      <NowWords playback={playback} step={step} index={index} segment={segment} />
      {playback.segments.length > 0 ? (
        <HStack gap="1" ml="auto" role="group" aria-label="After the body">
          {playback.segments.map((each) => (
            <GoToSegment key={each.phase} segment={each} playback={playback} />
          ))}
        </HStack>
      ) : null}
    </HStack>
  )
}

/** The words for the player's moment: the stretch after the body, else the step running. */
function NowWords({
  playback,
  step,
  index,
  segment,
}: {
  readonly playback: Playback
  readonly step: ReplayMark | undefined
  readonly index: number | undefined
  readonly segment: ReplaySegment | undefined
}) {
  if (segment !== undefined)
    return (
      <>
        <Span fontWeight="500" color={segment.bad ? "verdict.failed.fg" : "ink.strong"}>
          {segment.phase === "settle" ? "Waiting for background work" : "Checking what the app did"}
        </Span>
        {playback.playing && playback.speeding ? (
          <Span color="ink.muted">playing at {TAIL_RATE}×</Span>
        ) : null}
      </>
    )

  return (
    <>
      {step ? (
        <>
          <Span color="ink.muted">Step {index}</Span>
          <Span fontWeight="500" color={step.bad ? "verdict.failed.fg" : "ink.strong"} truncate>
            {step.label}
          </Span>
        </>
      ) : (
        <Span color="ink.muted">Before the first step</Span>
      )}
    </>
  )
}

/**
 * The run replayed: its video (or its screenshots, when it kept none) with the steps and faults on
 * the scrubber, moving the step list and the waterfall along with it.
 */
export function RecordPlayer({
  dir,
  replay,
  playback,
}: {
  readonly dir: string
  readonly replay: Replay
  readonly playback: Playback
}) {
  return (
    <Stack gap="0">
      <Box
        bg="surface.track"
        rounded="10px"
        overflow="hidden"
        aspectRatio="16 / 9"
        maxW="50rem"
        w="full"
        mx="auto"
      >
        {playback.video ? (
          <styled.video
            ref={playback.videoRef}
            src={playback.video.src}
            preload="auto"
            playsInline
            muted
            aria-label={`Video of the run${replay.videos.length > 1 ? `, ${videoName(replay.videos, playback.tab).toLowerCase()}` : ""}`}
            w="full"
            h="full"
            objectFit="contain"
            onClick={playback.toggle}
          />
        ) : (
          <Still dir={dir} replay={replay} playback={playback} />
        )}
      </Box>
      <Controls playback={playback} videos={replay.videos} />
      <NowLine playback={playback} />
    </Stack>
  )
}
