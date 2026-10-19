import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react"

import { Button, segment, SegmentTrack } from "../../components/controls.tsx"
import { clock, frameAt, type Replay, type ReplayMark, stepAt } from "./record-replay.ts"
import type { Playback } from "./use-playback.ts"
import { useScreenshot } from "./use-screenshot.ts"

const RATES = [0.5, 1, 2, 4] as const

/** A fraction of the scrubber's span, as a CSS percentage. */
function at(playback: Playback, ms: number): string {
  const span = Math.max(playback.endMs - playback.startMs, 1)

  return `${Math.min(Math.max((ms - playback.startMs) / span, 0), 1) * 100}%`
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
      style={{ left: at(playback, mark.atMs), transform: "translate(-50%, -50%) rotate(45deg)" }}
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
      <Box
        position="absolute"
        top="50%"
        w="3"
        h="3"
        rounded="full"
        bg="surface.chip"
        boxShadow="chip"
        pointerEvents="none"
        style={{ left: at(playback, playback.ms), transform: "translate(-50%, -50%)" }}
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
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      look="ghost"
      aria-label="Copy a link to this moment"
      title="Copy a link to this moment"
      onClick={() => {
        const url = new URL(window.location.href)

        url.hash = ""
        url.searchParams.set("t", ((playback.ms - playback.startMs) / 1000).toFixed(1))
        void navigator.clipboard.writeText(url.href).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2_000)
        })
      }}
    >
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copyLink size={14} />}
    </Button>
  )
}

/** Play or pause, the clock, the scrubber, the speed, and a link to the moment. */
function Controls({ playback, tabs }: { readonly playback: Playback; readonly tabs: number }) {
  return (
    <HStack gap="2" flexWrap="wrap" mt="2.5">
      <Button
        type="button"
        look="primary"
        w="8"
        px="0"
        aria-label={playback.playing ? "Pause" : "Play"}
        onClick={playback.toggle}
      >
        {playback.playing ? <Icons.pause size={14} /> : <Icons.play size={14} />}
      </Button>
      <styled.span
        fontSize="1"
        color="ink.soft"
        fontVariantNumeric="tabular-nums"
        minW="6.5rem"
        aria-live="off"
      >
        {clock(playback.ms - playback.startMs)} / {clock(playback.endMs - playback.startMs)}
      </styled.span>
      <Scrubber playback={playback} />
      <SegmentTrack role="group" aria-label="Speed">
        {RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            className={segment}
            data-on={playback.rate === rate || undefined}
            aria-pressed={playback.rate === rate}
            onClick={() => playback.setRate(rate)}
          >
            {rate}×
          </button>
        ))}
      </SegmentTrack>
      {tabs > 1 ? (
        <SegmentTrack role="group" aria-label="Tab">
          {Array.from({ length: tabs }, (_, i) => (
            <button
              key={i}
              type="button"
              className={segment}
              data-on={playback.tab === i || undefined}
              aria-pressed={playback.tab === i}
              onClick={() => playback.pickTab(i)}
            >
              Tab {i + 1}
            </button>
          ))}
        </SegmentTrack>
      ) : null}
      <CopyMoment playback={playback} />
    </HStack>
  )
}

/** What is happening at the player's moment: the step running, and the run's problems near it. */
function NowLine({ playback }: { readonly playback: Playback }) {
  const index = stepAt(playback.marks, playback.ms)
  const step = playback.marks.find((mark) => mark.kind === "step" && mark.step === index)

  return (
    <HStack gap="2" mt="2" fontSize="1" color="ink.soft" minH="5" aria-live="polite">
      {step ? (
        <>
          <styled.span color="ink.muted">Step {index}</styled.span>
          <styled.span
            fontWeight="500"
            color={step.bad ? "verdict.failed.fg" : "ink.strong"}
            truncate
          >
            {step.label}
          </styled.span>
        </>
      ) : (
        <styled.span color="ink.muted">Before the first step</styled.span>
      )}
    </HStack>
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
            aria-label={`Video of the run${replay.videos.length > 1 ? `, tab ${playback.video.tab}` : ""}`}
            w="full"
            h="full"
            objectFit="contain"
            onClick={playback.toggle}
          />
        ) : (
          <Still dir={dir} replay={replay} playback={playback} />
        )}
      </Box>
      <Controls playback={playback} tabs={replay.videos.length} />
      <NowLine playback={playback} />
    </Stack>
  )
}
