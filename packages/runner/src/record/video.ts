/**
 * Video of an attempt: what the screen showed while the test ran, lined up with its steps and with
 * the calls and webhooks behind them. Every offset is in milliseconds from the video's first frame,
 * so a player can seek to a step, a provider call or the fault that landed on it.
 */

/**
 * When the flight recorder keeps video: `on` (the default) keeps it with every record kept;
 * `retain-on-failure` records every run and keeps the video of runs that did not pass; `off`
 * records none. Video shows the screen as it was: fields holding a secret are masked, but a secret the app
 * prints as plain text is visible, so suites that show secrets should turn video off.
 */
export type VideoMode = "retain-on-failure" | "on" | "off"

/** A video the session captured, before the recorder lines it up with the run. */
export interface CapturedVideo {
  /** Relative to the attempt's directory, e.g. `video/tab-1.webm`. */
  readonly file: string
  /** When its first frame was taken, by the wall clock. */
  readonly startedAt: string
  readonly durationMs: number
  /** The tab it shows, 1 for the first; a device's screen is 1. */
  readonly tab: number
}

/** A step, call or webhook placed on a video's clock. */
export interface VideoMark {
  readonly kind: "step" | "call" | "webhook"
  /** The step's index, the call's id, or the delivery's `service:message:attempt`. */
  readonly id: string
  readonly label: string
  /** Milliseconds after the video's first frame; negative when it happened before the video began. */
  readonly startMs: number
  readonly endMs: number
  /** True for a step that did not pass, a 4xx/5xx, or a call that got no answer. */
  readonly bad: boolean
  /** The fault injected into this call or delivery, if any. */
  readonly fault?: string
}

/** A video as the flight record keeps it: the file, and the run's steps, calls and webhooks on its clock. */
export type RecordedVideo = CapturedVideo & { readonly marks: readonly VideoMark[] }

/** The parts of a run a video's marks are made from. */
export interface MarkedRun {
  readonly steps: readonly {
    readonly index: number
    readonly label: string
    readonly status: string
    readonly startedAt: string
    readonly durationMs: number
  }[]
  readonly exchanges: readonly {
    readonly id: string
    readonly method: string
    readonly host: string
    readonly path: string
    readonly startedAt: string
    readonly durationMs: number | null
    readonly status: number | null
    readonly aborted: boolean
    readonly fault: string | null
  }[]
  readonly deliveries: readonly {
    readonly messageId: number
    readonly topic: string
    readonly attempt: number
    readonly at: string
    readonly sentAt?: string | undefined
    readonly durationMs: number
    readonly status: number | null
    readonly service?: string | undefined
    readonly fault: string | null
  }[]
}

/** Milliseconds from `origin` to `iso`; undefined for a time that does not parse. */
function offset(origin: number, iso: string): number | undefined {
  const at = Date.parse(iso)

  return Number.isNaN(at) ? undefined : at - origin
}

function failedStatus(status: number | null): boolean {
  return status === null || status >= 400
}

/** One mark, or none when its time does not parse. */
function mark(
  base: Omit<VideoMark, "startMs" | "endMs">,
  start: number | undefined,
  durationMs: number,
): VideoMark[] {
  if (start === undefined) return []

  return [{ ...base, startMs: start, endMs: start + Math.max(durationMs, 0) }]
}

function stepMarks(origin: number, run: MarkedRun): VideoMark[] {
  return run.steps.flatMap((step) =>
    mark(
      {
        kind: "step",
        id: String(step.index),
        label: step.label,
        bad: step.status !== "passed",
      },
      offset(origin, step.startedAt),
      step.durationMs,
    ),
  )
}

function callMarks(origin: number, run: MarkedRun): VideoMark[] {
  return run.exchanges.flatMap((call) =>
    mark(
      {
        kind: "call",
        id: call.id,
        label: `${call.method} ${call.host}${call.path.split("?")[0] ?? ""}`,
        bad: call.aborted || failedStatus(call.status),
        ...(call.fault !== null && { fault: call.fault }),
      },
      offset(origin, call.startedAt),
      call.durationMs ?? 0,
    ),
  )
}

function webhookMarks(origin: number, run: MarkedRun): VideoMark[] {
  return run.deliveries.flatMap((delivery) =>
    mark(
      {
        kind: "webhook",
        id: `${delivery.service ?? "webhook"}:${delivery.messageId}:${delivery.attempt}`,
        label: `${delivery.service ? `${delivery.service} ` : ""}${delivery.topic}`,
        bad: failedStatus(delivery.status),
        ...(delivery.fault !== null && { fault: delivery.fault }),
      },
      offset(origin, delivery.sentAt ?? delivery.at),
      delivery.durationMs,
    ),
  )
}

/**
 * Every step, call and webhook of `run` on `video`'s clock, in the order they started. A delivery is
 * placed by the wall clock it was sent at, so a held emulator clock does not move it.
 */
export function videoMarks(video: Pick<CapturedVideo, "startedAt">, run: MarkedRun): VideoMark[] {
  const origin = Date.parse(video.startedAt)

  if (Number.isNaN(origin)) return []

  return [
    ...stepMarks(origin, run),
    ...callMarks(origin, run),
    ...webhookMarks(origin, run),
  ].toSorted((a, b) => a.startMs - b.startMs)
}

/** Whether a run's video is kept under `mode`, given whether the run passed. */
export function keepsVideo(mode: VideoMode, passed: boolean): boolean {
  return mode === "on" || (mode === "retain-on-failure" && !passed)
}

/** The folder of an attempt's directory its videos go in. */
export const VIDEO_DIR = "video"

/** The size video is recorded at: wide enough to read a page, small enough to keep many. */
export const VIDEO_SIZE = { width: 1024, height: 576 } as const
