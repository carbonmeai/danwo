import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Exchange, Proxy } from "@danwo/proxy"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { startDeviceFilm } from "../src/device/film.ts"
import type { DeviceTarget } from "../src/device/types.ts"
import type { SessionFlight } from "../src/flight.ts"
import {
  keepsVideo,
  type MarkedRun,
  videoCursorOf,
  videoMarks,
  videoModeOf,
  type VideoSetting,
} from "../src/record/video.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"
import { buildRecord, finishRecord, type RecordInput } from "../src/runner/record.ts"
import { openRecording } from "../src/runner/recording.ts"

const VIDEO_START = "2026-10-19T10:00:01.000Z"

/** A run of two steps: one call during the first (faulted), a webhook during the second. */
const RUN: MarkedRun = {
  steps: [
    {
      index: 0,
      label: "/",
      status: "passed",
      startedAt: "2026-10-19T10:00:01.250Z",
      durationMs: 500,
    },
    {
      index: 1,
      label: "Pay",
      status: "failed",
      startedAt: "2026-10-19T10:00:02.000Z",
      durationMs: 1_000,
    },
  ],
  exchanges: [
    {
      id: "e1",
      method: "POST",
      host: "api.stripe.com",
      path: "/v1/checkout/sessions?expand=line_items",
      startedAt: "2026-10-19T10:00:01.400Z",
      durationMs: 40,
      status: 500,
      aborted: false,
      fault: "status 500",
    },
  ],
  deliveries: [
    {
      messageId: 7,
      topic: "checkout.session.completed",
      attempt: 2,
      /* The emulator's clock was held back an hour; the wall clock places it. */
      at: "2026-10-19T09:00:00.000Z",
      sentAt: "2026-10-19T10:00:02.500Z",
      durationMs: 12,
      status: 200,
      service: "stripe",
      fault: "duplicate",
    },
  ],
}

/** A loaded config with `video` set, or none. */
function loaded(video?: VideoSetting) {
  return { config: video === undefined ? {} : { video }, path: undefined, root: "/project" }
}

describe("video marks", () => {
  it("places steps, calls and webhooks on the video's clock, in the order they started", () => {
    expect(videoMarks({ startedAt: VIDEO_START }, RUN)).toEqual([
      { kind: "step", id: "0", label: "/", bad: false, startMs: 250, endMs: 750 },
      {
        kind: "call",
        id: "e1",
        label: "POST api.stripe.com/v1/checkout/sessions",
        bad: true,
        fault: "status 500",
        startMs: 400,
        endMs: 440,
      },
      { kind: "step", id: "1", label: "Pay", bad: true, startMs: 1_000, endMs: 2_000 },
      {
        kind: "webhook",
        id: "stripe:7:2",
        label: "stripe checkout.session.completed",
        bad: false,
        fault: "duplicate",
        startMs: 1_500,
        endMs: 1_512,
      },
    ])
  })

  it("keeps what happened before the first frame at a negative offset, and drops unreadable times", () => {
    const marks = videoMarks(
      { startedAt: VIDEO_START },
      {
        steps: [{ ...RUN.steps[0]!, startedAt: "2026-10-19T10:00:00.900Z" }],
        exchanges: [{ ...RUN.exchanges[0]!, startedAt: "not a time", durationMs: null }],
        deliveries: [],
      },
    )

    expect(marks.map((mark) => [mark.kind, mark.startMs])).toEqual([["step", -100]])
    expect(videoMarks({ startedAt: "not a time" }, RUN)).toEqual([])
  })

  it("keeps video of runs that did not pass by default, of every kept run under on, of none under off", () => {
    expect(keepsVideo("retain-on-failure", false)).toBe(true)
    expect(keepsVideo("retain-on-failure", true)).toBe(false)
    expect(keepsVideo("on", true)).toBe(true)
    expect(keepsVideo("off", false)).toBe(false)
  })

  it("takes the video mode from the option, else the config, else on, and keeps every run", () => {
    expect(openRecording(loaded(), undefined)?.video).toBe("on")
    expect(openRecording(loaded(), undefined)?.mode).toBe("always")
    expect(openRecording(loaded("off"), undefined)?.video).toBe("off")
    expect(openRecording(loaded("off"), undefined, "retain-on-failure")?.video).toBe(
      "retain-on-failure",
    )
    expect(openRecording(loaded(), "off", "on")).toBeUndefined()
    expect(openRecording(loaded({ mode: "off" }), undefined)?.video).toBe("off")
    expect(openRecording(loaded({ cursor: false }), undefined)?.video).toBe("on")
  })

  it("reads the mode and the pointer from either form of the setting, the pointer on by default", () => {
    expect(videoModeOf(undefined)).toBeUndefined()
    expect(videoModeOf("retain-on-failure")).toBe("retain-on-failure")
    expect(videoModeOf({ mode: "off", cursor: true })).toBe("off")
    expect(videoModeOf({ cursor: false })).toBeUndefined()
    expect(videoCursorOf(undefined)).toBe(true)
    expect(videoCursorOf("on")).toBe(true)
    expect(videoCursorOf({ mode: "on" })).toBe(true)
    expect(videoCursorOf({ cursor: false })).toBe(false)
  })
})

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-video-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A session that filmed one tab and ran the steps of `RUN`. */
function filmedSession(): SessionFlight {
  return {
    steps: () =>
      RUN.steps.map((step) => ({
        ...step,
        status: step.status === "passed" ? ("passed" as const) : ("failed" as const),
        id: `s${step.index}`,
        kind: "locator" as const,
        api: "locator.click",
        events: [],
      })),
    appLog: () => [],
    screenshots: () => new Map(),
    redact: (text) => text,
    captureFailure: () => Promise.resolve(undefined),
    settle: () => Promise.resolve(),
    videos: () => [{ file: "video/tab-1.webm", startedAt: VIDEO_START, durationMs: 2_500, tab: 1 }],
  }
}

function input(video: boolean): RecordInput {
  const exchanges: Exchange[] = RUN.exchanges.map((call) => ({ ...call, disposition: "routed" }))
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the recorder reads only the exchange log
  const proxy = { exchanges: () => exchanges, sockets: () => [] } as unknown as Proxy
  const env: WorkerEnvironment = { proxy, close: () => Promise.resolve() }

  return {
    test: "tests/pay.danwo.ts › pays",
    run: { kind: "test", attempt: 1 },
    status: "failed",
    error: undefined,
    stopped: undefined,
    divergence: undefined,
    notes: [],
    durationMs: 2_000,
    flight: { session: filmedSession(), failure: undefined, startedAt: VIDEO_START },
    env,
    mark: { exchanges: 0, deliveries: 0 },
    video,
  }
}

describe("video in flight records", () => {
  it("keeps the session's video with the run's steps and calls on its clock", () => {
    const record = buildRecord(input(true))

    expect(record.videos).toHaveLength(1)
    expect(record.videos?.[0]).toMatchObject({
      file: "video/tab-1.webm",
      tab: 1,
      durationMs: 2_500,
    })
    expect(
      record.videos?.[0]?.marks.map((mark) => `${mark.kind} ${mark.id} ${mark.startMs}`),
    ).toEqual(["step 0 250", "call e1 400", "step 1 1000"])
  })

  it("drops the video files of a record that keeps none, and leaves the rest of the record", async () => {
    const dir = join(root, "attempt-1")

    await mkdir(join(dir, "video"), { recursive: true })
    await writeFile(join(dir, "video", "tab-1.webm"), "film")

    await finishRecord(dir, "always", false, () => buildRecord(input(false)))

    expect(existsSync(join(dir, "video"))).toBe(false)
    expect(JSON.parse(await readFile(join(dir, "record.json"), "utf8"))).not.toHaveProperty(
      "videos",
    )

    await mkdir(join(dir, "video"), { recursive: true })
    await writeFile(join(dir, "video", "tab-1.webm"), "film")
    await finishRecord(dir, "always", true, () => buildRecord(input(true)))

    expect(existsSync(join(dir, "video", "tab-1.webm"))).toBe(true)
  })
})

/** A device that films into a file when stopped, or cannot film at all. */
function device(films: boolean, stops = true): DeviceTarget {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the film reads only recordScreen
  const target = {
    ...(films && {
      recordScreen: (path: string) =>
        Promise.resolve({
          startedAt: Date.parse(VIDEO_START),
          stop: async () => {
            if (stops) await writeFile(path, "mp4")

            return stops
          },
        }),
    }),
  } as unknown as DeviceTarget

  return target
}

describe("device film", () => {
  it("films the screen into video/screen.mp4 and reports it once stopped", async () => {
    const film = await startDeviceFilm(device(true), root)

    expect(film?.videos()).toEqual([])
    await film?.stop()

    expect(film?.videos()).toEqual([
      expect.objectContaining({ file: "video/screen.mp4", startedAt: VIDEO_START, tab: 1 }),
    ])
    expect(await readFile(join(root, "video", "screen.mp4"), "utf8")).toBe("mp4")
  })

  it("has no film for a device that cannot film, nor a video when the file was not written", async () => {
    expect(await startDeviceFilm(device(false), root)).toBeUndefined()

    const film = await startDeviceFilm(device(true, false), root)

    await film?.stop()
    expect(film?.videos()).toEqual([])
  })
})
