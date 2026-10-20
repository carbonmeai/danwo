/**
 * What the replay player plays: the record's videos with their steps, calls and webhooks, or, with
 * no video (turned off, or an older record), the step screenshots in time order. Every time here is
 * on the record's clock, milliseconds after the record started, the clock the waterfall uses too.
 */
import type { FlightRecord, VideoMark } from "@danwo/runner/runner"

import type { Timeline } from "./record-timeline.ts"

/** A step, call or webhook on the player's scrubber. */
export interface ReplayMark {
  readonly kind: VideoMark["kind"]
  readonly label: string
  readonly atMs: number
  readonly endMs: number
  readonly bad: boolean
  readonly fault?: string
  /** The step's index, for steps. */
  readonly step?: number
}

/** One tab's video (or the device's screen). */
export interface ReplayVideo {
  /** Where the dashboard serves the file. */
  readonly src: string
  readonly tab: number
  /** The person whose browser it shows, when the test opened more than one person's. */
  readonly user?: string
  /** When the video's first frame was taken. */
  readonly startMs: number
  readonly durationMs: number
  readonly marks: readonly ReplayMark[]
  /** For a popup or a tab the app opened: the index of the video of the tab that opened it. */
  readonly opener?: number
  /** The host of the first web page the tab showed. */
  readonly host?: string
  /** The tab closed before the browser did, and the run went back to its opener. */
  readonly closed?: boolean
}

/**
 * Where the run moved between tabs: a popup opening (`Popup opened: accounts.provider.test`) and
 * the run coming back once it closed. `video` is the index of the video the run moved to.
 */
export interface ReplayTabMark {
  readonly kind: "opened" | "closed"
  readonly label: string
  readonly atMs: number
  readonly video: number
}

/** A step's screenshot, shown from the moment its step ended. */
export interface ReplayFrame {
  readonly atMs: number
  readonly step: number
  readonly screenshot: string
}

/**
 * A stretch of the run after its body, shaded on the scrubber: the wait for background work
 * (`settle`), then the invariant's checks of what the app did. The browser sits idle through both.
 */
export interface ReplaySegment {
  readonly phase: "settle" | "checks"
  readonly label: string
  readonly atMs: number
  readonly endMs: number
  /** A check in it failed, or the wait gave up. */
  readonly bad: boolean
}

export interface Replay {
  readonly videos: readonly ReplayVideo[]
  /** Screenshots to step through when there is no video. */
  readonly frames: readonly ReplayFrame[]
  /** Steps, calls and webhooks from the timeline, for the screenshot player's scrubber. */
  readonly marks: readonly ReplayMark[]
  /** The settle wait and the checks, in order; empty for records made before they were kept. */
  readonly segments: readonly ReplaySegment[]
  /** Which video shows each step, by step index: the tab it ran in, in its person's browser. */
  readonly stepVideos: Readonly<Record<number, number>>
  /** Popups opening and the run coming back from them, in time order. */
  readonly tabMarks: readonly ReplayTabMark[]
  /** The record's span, from its start to the last thing it timed. */
  readonly spanMs: number
}

/** The URL prefix the dashboard serves a record's videos under. */
const MEDIA_PREFIX = "/media/"

/** The URL of `file` in the record folder `dir` (`.danwo/runs/...`, relative to the project). */
export function mediaUrl(dir: string, file: string): string {
  const inRuns = dir.replace(/^\.danwo\/runs\//, "")

  return `${MEDIA_PREFIX}${[...inRuns.split("/"), ...file.split("/")].map(encodeURIComponent).join("/")}`
}

function millis(iso: string): number {
  const at = Date.parse(iso)

  return Number.isNaN(at) ? 0 : at
}

/** A video mark moved from the video's clock onto the record's. */
function onRecordClock(mark: VideoMark, shift: number): ReplayMark {
  return {
    kind: mark.kind,
    label: mark.label,
    atMs: mark.startMs + shift,
    endMs: mark.endMs + shift,
    bad: mark.bad,
    ...(mark.fault !== undefined && { fault: mark.fault }),
    ...(mark.kind === "step" && { step: Number(mark.id) }),
  }
}

/** The timeline's items as scrubber marks. */
function timelineMarks(timeline: Timeline): ReplayMark[] {
  return timeline.items.map((item) => ({
    kind: item.kind,
    label: item.label,
    atMs: item.startMs,
    endMs: item.startMs + item.durationMs,
    bad: item.bad,
    ...(item.fault !== undefined && { fault: item.fault }),
    ...(item.kind === "step" && item.step !== undefined && { step: item.step }),
  }))
}

/** Each step's screenshot from when its step ended, in time order. */
function framesOf(record: Pick<FlightRecord, "startedAt" | "steps">): ReplayFrame[] {
  const origin = millis(record.startedAt)

  return record.steps
    .flatMap((step) =>
      step.screenshot === undefined
        ? []
        : [
            {
              atMs: millis(step.startedAt) - origin + step.durationMs,
              step: step.index,
              screenshot: step.screenshot,
            },
          ],
    )
    .toSorted((a, b) => a.atMs - b.atMs)
}

type TimedStep = Pick<
  FlightRecord["steps"][number],
  "startedAt" | "durationMs" | "phase" | "status"
>

/**
 * The settle wait and the checks on the record's clock. The checks run from where settling ended
 * to the teardown (or the record's end), since the browser stays idle past the last check too.
 */
function segmentsOf(
  record: Pick<FlightRecord, "startedAt" | "durationMs"> & { readonly steps: readonly TimedStep[] },
): ReplaySegment[] {
  const origin = millis(record.startedAt)
  const startOf = (step: TimedStep) => millis(step.startedAt) - origin
  const endOf = (step: TimedStep) => startOf(step) + step.durationMs
  const wait = record.steps.find((step) => step.phase === "settle")
  const checks = record.steps.filter((step) => step.phase === "checks")
  const teardown = record.steps.find((step) => step.phase === "teardown")
  const settled =
    wait === undefined
      ? []
      : [
          {
            phase: "settle" as const,
            label: "Settling",
            atMs: startOf(wait),
            endMs: endOf(wait),
            bad: wait.status !== "passed",
          },
        ]
  const [first] = checks

  if (first === undefined) return settled

  const atMs = wait === undefined ? startOf(first) : endOf(wait)
  const endMs = Math.max(
    teardown === undefined ? record.durationMs : startOf(teardown),
    ...checks.map(endOf),
  )

  return [
    ...settled,
    {
      phase: "checks",
      label: "Checks",
      atMs,
      endMs,
      bad: checks.some((step) => step.status !== "passed"),
    },
  ]
}

/** Whether `ms` is in the idle tail after the body, from the first segment on. */
export function inTail(segments: readonly ReplaySegment[], ms: number): boolean {
  const [first] = segments

  return first !== undefined && ms >= first.atMs
}

type Filmed = NonNullable<FlightRecord["videos"]>[number]

/** The index of the video of tab `tab` in `user`'s browser, or -1. */
function videoOfTab(
  videos: readonly Pick<Filmed, "tab" | "user">[],
  tab: number,
  user: string | undefined,
): number {
  return videos.findIndex((video) => video.tab === tab && video.user === user)
}

/**
 * Which video shows each step: the one of the tab it ran in, else (a record from before steps
 * kept their tab) the first video of its person's browser that marks it.
 */
function stepVideosOf(
  steps: readonly Pick<FlightRecord["steps"][number], "index" | "tab" | "user">[],
  videos: readonly ReplayVideo[],
): Record<number, number> {
  const shown: Record<number, number> = {}

  for (const step of steps) {
    const own = step.tab === undefined ? -1 : videoOfTab(videos, step.tab, step.user)
    const marked = videos.findIndex((video) =>
      video.marks.some((mark) => mark.kind === "step" && mark.step === step.index),
    )
    const video = own >= 0 ? own : marked

    if (video >= 0) shown[step.index] = video
  }

  return shown
}

/** The popups opening, and the run going back to the tab that opened each once it closed. */
function tabMarksOf(videos: readonly ReplayVideo[]): ReplayTabMark[] {
  return videos
    .flatMap((video, at): ReplayTabMark[] => {
      if (video.opener === undefined) return []

      const opened = {
        kind: "opened" as const,
        label: `Popup opened: ${video.host ?? "a new tab"}`,
        atMs: video.startMs,
        video: at,
      }
      const back = videos[video.opener]

      if (video.closed !== true || back === undefined) return [opened]

      return [
        opened,
        {
          kind: "closed",
          label:
            back.opener === undefined ? "Back to the app" : `Back to ${back.host ?? "its opener"}`,
          atMs: video.startMs + video.durationMs,
          video: video.opener,
        },
      ]
    })
    .toSorted((a, b) => a.atMs - b.atMs)
}

/** A recorded video as the player plays it, on the record's clock. */
function replayVideo(dir: string, origin: number, video: Filmed, videos: readonly Filmed[]) {
  const startMs = millis(video.startedAt) - origin
  const opener = video.opener === undefined ? -1 : videoOfTab(videos, video.opener, video.user)

  return {
    src: mediaUrl(dir, video.file),
    tab: video.tab,
    ...(video.user !== undefined && { user: video.user }),
    startMs,
    durationMs: video.durationMs,
    marks: video.marks.map((mark) => onRecordClock(mark, startMs)),
    ...(opener >= 0 && { opener }),
    ...(video.host !== undefined && { host: video.host }),
    ...(video.closed === true && { closed: true }),
  }
}

/** What the player plays for the record in `dir`. */
export function replayOf(
  dir: string,
  record: Pick<FlightRecord, "startedAt" | "durationMs" | "steps" | "videos">,
  timeline: Timeline,
): Replay {
  const origin = millis(record.startedAt)
  const filmed = record.videos ?? []
  const videos = filmed.map((video) => replayVideo(dir, origin, video, filmed))

  return {
    videos,
    frames: framesOf(record),
    marks: timelineMarks(timeline),
    segments: segmentsOf(record),
    spanMs: timeline.spanMs,
    stepVideos: stepVideosOf(record.steps, videos),
    tabMarks: tabMarksOf(videos),
  }
}

/** Whether `video` was filming at `ms`. */
function films(video: ReplayVideo | undefined, ms: number): boolean {
  return video !== undefined && ms >= video.startMs && ms < video.startMs + video.durationMs
}

/**
 * The video the player follows the action to at `ms`, playing video `current`: the one of the tab
 * the step running then ran in, once that tab is open; else, when `current` has stopped filming
 * (its popup closed), the video of the tab that opened it. Otherwise it stays on `current`.
 */
export function followedVideo(replay: Replay, current: number, ms: number): number {
  const playing = replay.videos[current]

  if (playing === undefined) return current

  const step = stepAt(playing.marks, ms)
  const wanted = step === undefined ? undefined : replay.stepVideos[step]

  if (wanted !== undefined && wanted !== current && films(replay.videos[wanted], ms)) return wanted
  if (films(playing, ms) || playing.opener === undefined) return current

  return playing.opener
}

/** Whether video `index` shows a popup or a tab the app opened, rather than the app's first tab. */
export function isPopup(videos: readonly ReplayVideo[], index: number | undefined): boolean {
  return index !== undefined && videos[index]?.opener !== undefined
}

/** Who the test's own browser is, beside the other people a test opened browsers for. */
const OWN_BROWSER = "you"

/**
 * How the player names video `index` of `videos`: by tab alone, or with whose browser it shows
 * once a test opened more than one person's (`bob · tab 1`, `you · tab 1`).
 */
export function videoName(videos: readonly ReplayVideo[], index: number): string {
  const video = videos[index]

  if (video === undefined) return `Tab ${index + 1}`

  return videos.some((each) => each.user !== undefined)
    ? `${video.user ?? OWN_BROWSER} · tab ${video.tab}`
    : `Tab ${video.tab}`
}

/** The frame showing at `ms`: the last one whose step had ended, else the first. */
export function frameAt(frames: readonly ReplayFrame[], ms: number): ReplayFrame | undefined {
  return frames.findLast((frame) => frame.atMs <= ms) ?? frames[0]
}

/**
 * The step running at `ms`, else the last one that started before it. Where one step ends as the
 * next starts, the one starting wins.
 */
export function stepAt(marks: readonly ReplayMark[], ms: number): number | undefined {
  const steps = marks.filter((mark) => mark.kind === "step")
  const running = steps.findLast((mark) => ms >= mark.atMs && ms <= mark.endMs)

  return (running ?? steps.findLast((mark) => mark.atMs <= ms))?.step
}

/** `ms` as the player's clock reads it: `m:ss.t`. */
export function clock(ms: number): string {
  const tenths = Math.max(Math.round(ms / 100), 0)
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)

  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`
}

/**
 * Where a link asks the player to start, on the player's own clock: `?t=12.5` is 12.5 seconds in,
 * `#step-3` is where step 3 starts. Undefined when the link names neither.
 */
export function linkedMoment(
  link: { readonly search: string; readonly hash: string },
  marks: readonly ReplayMark[],
  startMs: number,
): number | undefined {
  const step = /^#step-(\d+)$/.exec(link.hash)?.[1]

  if (step !== undefined) return marks.find((mark) => mark.step === Number(step))?.atMs

  const seconds = Number(new URLSearchParams(link.search).get("t") ?? Number.NaN)

  return Number.isFinite(seconds) && seconds >= 0 ? startMs + seconds * 1000 : undefined
}
