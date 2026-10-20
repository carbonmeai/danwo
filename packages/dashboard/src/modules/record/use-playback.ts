/**
 * The replay player's clock, shared by the player, the step list and the waterfall: where the run
 * is, whether it plays and how fast. With a video the video drives it; without one, a timer steps
 * through the screenshots. Times are on the record's clock, as the waterfall shows them.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

import { linkedMoment, type Replay, type ReplayMark, type ReplayVideo } from "./record-replay.ts"

export interface Playback {
  /** Where the run is, in milliseconds on the record's clock. */
  readonly ms: number
  /** The span the scrubber covers. */
  readonly startMs: number
  readonly endMs: number
  readonly playing: boolean
  readonly rate: number
  /** The video playing, undefined when the screenshots stand in for one. */
  readonly video: ReplayVideo | undefined
  readonly videoRef: RefObject<HTMLVideoElement | null>
  /** The scrubber's steps, calls and webhooks. */
  readonly marks: readonly ReplayMark[]
  /** Which of the record's videos plays. */
  readonly tab: number
  readonly seek: (ms: number) => void
  readonly toggle: () => void
  readonly setRate: (rate: number) => void
  readonly pickTab: (index: number) => void
  /**
   * Shows the moment `ms` of video `tab`: another person's step plays in their browser's video,
   * so the player switches to it first.
   */
  readonly showAt: (tab: number, ms: number) => void
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** Runs `tick` with the milliseconds since the last frame, every animation frame while `on`. */
function useFrames(on: boolean, tick: (elapsed: number) => void): void {
  const latest = useRef(tick)

  latest.current = tick

  useEffect(() => {
    if (!on) return undefined

    let last = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      latest.current(now - last)
      last = now
      frame = requestAnimationFrame(step)
    })

    return () => cancelAnimationFrame(frame)
  }, [on])
}

/** Listens to `events` of the video element while it is mounted. */
function useVideoEvent(
  ref: RefObject<HTMLVideoElement | null>,
  video: ReplayVideo | undefined,
  events: readonly string[],
  listen: (element: HTMLVideoElement) => void,
): void {
  const latest = useRef(listen)

  latest.current = listen

  useEffect(() => {
    const element = ref.current

    if (element === null) return undefined

    const heard = () => latest.current(element)

    for (const event of events) element.addEventListener(event, heard)

    return () => {
      for (const event of events) element.removeEventListener(event, heard)
    }
  }, [ref, video, events])
}

const LENGTH_EVENTS = ["loadedmetadata", "durationchange"]
const STATE_EVENTS = ["play", "pause", "ended"]

/** How long the video runs: what the file says once loaded, else what the record says. */
function useVideoLength(video: ReplayVideo | undefined, ref: RefObject<HTMLVideoElement | null>) {
  const [length, setLength] = useState(video?.durationMs ?? 0)

  useEffect(() => setLength(video?.durationMs ?? 0), [video])
  useVideoEvent(ref, video, LENGTH_EVENTS, (element) => {
    if (Number.isFinite(element.duration) && element.duration > 0)
      setLength(element.duration * 1000)
  })

  return length
}

function isPlaying(element: HTMLVideoElement): boolean {
  return !element.paused && !element.ended
}

/** Plays a paused video, pauses a playing one. */
function toggleVideo(element: HTMLVideoElement, failed: () => void): void {
  if (element.paused) void element.play().catch(failed)
  else element.pause()
}

/** What seeking and playing work on. */
interface ControlState {
  readonly videoRef: RefObject<HTMLVideoElement | null>
  readonly span: { readonly startMs: number; readonly endMs: number }
  readonly ms: number
  readonly setMs: (ms: number) => void
  readonly setPlaying: (playing: boolean | ((now: boolean) => boolean)) => void
}

/** Seeking within the span, and playing or pausing the video or the timer. */
function useControls({ videoRef, span, ms, setMs, setPlaying }: ControlState) {
  const { startMs, endMs } = span

  const seek = useCallback(
    (to: number) => {
      const at = clamp(to, startMs, Math.max(endMs, startMs))

      if (videoRef.current !== null) videoRef.current.currentTime = (at - startMs) / 1000
      setMs(at)
    },
    [videoRef, startMs, endMs, setMs],
  )

  const toggle = useCallback(() => {
    if (videoRef.current !== null) return toggleVideo(videoRef.current, () => setPlaying(false))

    if (ms >= endMs) setMs(startMs)
    setPlaying((now) => !now)
  }, [videoRef, ms, startMs, endMs, setMs, setPlaying])

  return { seek, toggle }
}

/**
 * Puts the player at the start of what plays: where the page's link points (`?t=` or `#step-N`)
 * the first time, the first frame after that. Resolves to how to forget the link, for a tab of its
 * own.
 */
function useOpening(
  marks: readonly ReplayMark[],
  startMs: number,
  seek: (ms: number) => void,
): () => void {
  const link = useRef<{ readonly ms: number | undefined }>(undefined)
  const latest = useRef(seek)

  latest.current = seek

  useEffect(() => {
    link.current ??= { ms: linkedMoment(window.location, marks, startMs) }
    latest.current(link.current.ms ?? startMs)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new start, not new marks, moves the player
  }, [startMs])

  return useCallback(() => {
    link.current = { ms: undefined }
  }, [])
}

/** What plays: the picked video's span and marks, else the screenshots' span and the timeline's. */
function shownSpan(replay: Replay, video: ReplayVideo | undefined, length: number) {
  if (video === undefined) return { startMs: 0, endMs: replay.spanMs, marks: replay.marks }

  return {
    startMs: video.startMs,
    endMs: video.startMs + length,
    marks: video.marks,
  }
}

/** Where the clock is next frame: the video's own time, else the timer's, up to the end. */
function nextMs(
  element: HTMLVideoElement | null,
  now: number,
  moved: number,
  span: { readonly startMs: number; readonly endMs: number },
): number {
  if (element !== null) return span.startMs + element.currentTime * 1000

  return Math.min(now + moved, span.endMs)
}

/** The clock while it plays, and the timer stopping at the end of the screenshots. */
function useTicks(
  state: ControlState & { readonly playing: boolean; readonly rate: number },
): void {
  const { videoRef, span, ms, setMs, setPlaying, playing, rate } = state

  useFrames(playing, (elapsed) => {
    const element = videoRef.current

    setMs(nextMs(element, ms, elapsed * rate, span))
  })

  useEffect(() => {
    if (videoRef.current === null && ms >= span.endMs) setPlaying(false)
  }, [videoRef, ms, span.endMs, setPlaying])
}

/** What seeking into another video needs: the video playing, its span, and how to switch. */
interface Switching {
  readonly tab: number
  readonly startMs: number
  readonly endMs: number
  readonly seek: (ms: number) => void
  readonly pickTab: (index: number) => void
}

/**
 * Seeks the player to a moment of any of its videos: at once in the one playing, else once the
 * other has loaded far enough to know its length (before that, a seek would stop at its start).
 */
function useSwitchedSeek({ tab, startMs, endMs, seek, pickTab }: Switching) {
  const pending = useRef<number>(undefined)

  useEffect(() => {
    if (pending.current === undefined || endMs <= startMs) return

    seek(pending.current)
    pending.current = undefined
  }, [tab, startMs, endMs, seek])

  return useCallback(
    (to: number, ms: number) => {
      if (to === tab) return seek(ms)

      pending.current = ms
      pickTab(to)
    },
    [tab, seek, pickTab],
  )
}

/** The player's clock for `replay`, starting where the page's link points when it names a moment. */
export function usePlayback(replay: Replay): Playback {
  const [tab, setTab] = useState(0)
  const video = replay.videos[tab]
  const videoRef = useRef<HTMLVideoElement>(null)
  const length = useVideoLength(video, videoRef)
  const { startMs, endMs, marks } = shownSpan(replay, video, length)
  const [ms, setMs] = useState(startMs)
  const [playing, setPlaying] = useState(false)
  const [rate, setRateState] = useState(1)

  useVideoEvent(videoRef, video, STATE_EVENTS, (element) => setPlaying(isPlaying(element)))

  useTicks({
    videoRef,
    span: { startMs, endMs },
    ms,
    setMs,
    setPlaying,
    playing,
    rate,
  })

  const { seek, toggle } = useControls({
    videoRef,
    span: { startMs, endMs },
    ms,
    setMs,
    setPlaying,
  })

  const setRate = useCallback((next: number) => {
    setRateState(next)
    if (videoRef.current !== null) videoRef.current.playbackRate = next
  }, [])

  /* Another tab's video starts from its own first frame. */
  const forgetLink = useOpening(marks, startMs, seek)

  const pickTab = useCallback(
    (index: number) => {
      forgetLink()
      setPlaying(false)
      setTab(index)
    },
    [forgetLink],
  )

  const showAt = useSwitchedSeek({ tab, startMs, endMs, seek, pickTab })

  return {
    ms,
    startMs,
    endMs,
    playing,
    rate,
    video,
    videoRef,
    marks,
    tab,
    seek,
    toggle,
    setRate,
    pickTab,
    showAt,
  }
}
