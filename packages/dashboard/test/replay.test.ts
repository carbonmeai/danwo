import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { tabMovesOf, transcriptOf } from "../src/modules/overlay/overlay-values.ts"
import { byteRange, serveMedia } from "../src/modules/record/record-media.ts"
import {
  clock,
  followedVideo,
  frameAt,
  inTail,
  isPopup,
  linkedMoment,
  mediaUrl,
  replayOf,
  stepAt,
  videoNotSaved,
} from "../src/modules/record/record-replay.ts"
import { timelineOf } from "../src/modules/record/record-timeline.ts"

const DIR = ".danwo/runs/20261019-100000-aaaa/tests-pay/attempt-1"

/** A record of two steps with screenshots, a faulted call, and a video that began 200 ms in. */
const RECORD = {
  startedAt: "2026-10-19T10:00:00.000Z",
  steps: [
    {
      index: 0,
      label: "/",
      status: "passed" as const,
      startedAt: "2026-10-19T10:00:00.300Z",
      durationMs: 200,
      screenshot: "screenshots/000-step-0.png",
    },
    {
      index: 1,
      label: "Pay",
      status: "failed" as const,
      startedAt: "2026-10-19T10:00:01.000Z",
      durationMs: 1_000,
      screenshot: "screenshots/001-step-1.png",
    },
  ],
  exchanges: [
    {
      method: "POST",
      host: "api.stripe.com",
      path: "/v1/charges",
      startedAt: "2026-10-19T10:00:01.200Z",
      durationMs: 30,
      status: 500,
      aborted: false,
      fault: "status 500",
    },
  ],
  deliveries: [],
  videos: [
    {
      file: "video/tab-1.webm",
      startedAt: "2026-10-19T10:00:00.200Z",
      durationMs: 2_000,
      tab: 1,
      marks: [
        { kind: "step" as const, id: "0", label: "/", startMs: 100, endMs: 300, bad: false },
        { kind: "step" as const, id: "1", label: "Pay", startMs: 800, endMs: 1_800, bad: true },
        {
          kind: "call" as const,
          id: "e1",
          label: "POST api.stripe.com/v1/charges",
          startMs: 1_000,
          endMs: 1_030,
          bad: true,
          fault: "status 500",
        },
      ],
    },
  ],
}

/** A passed step of `phase`, started `at` seconds in (`1.000`). */
function phaseStep(index: number, phase: string, at: string, durationMs: number) {
  return {
    index,
    label: phase,
    status: "passed" as const,
    phase,
    startedAt: `2026-10-19T10:00:0${at}Z`,
    durationMs,
  }
}

function replay(withVideo = true) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the replay reads times, steps and videos
  const record = (withVideo ? RECORD : { ...RECORD, videos: undefined }) as unknown as Parameters<
    typeof replayOf
  >[1]

  return replayOf(DIR, record, timelineOf(RECORD))
}

describe("the replay player's data", () => {
  it("serves a record's video under /media, relative to the runs folder", () => {
    expect(mediaUrl(DIR, "video/tab-1.webm")).toBe(
      "/media/20261019-100000-aaaa/tests-pay/attempt-1/video/tab-1.webm",
    )
  })

  it("moves the video's marks onto the record's clock, the waterfall's clock", () => {
    const [video] = replay().videos

    expect(video).toMatchObject({ tab: 1, startMs: 200, durationMs: 2_000 })
    expect(video?.marks.map((mark) => [mark.kind, mark.atMs, mark.step, mark.fault])).toEqual([
      ["step", 300, 0, undefined],
      ["step", 1_000, 1, undefined],
      ["call", 1_200, undefined, "status 500"],
    ])
  })

  it("steps through the screenshots when the record kept no video", () => {
    const stills = replay(false)

    expect(stills.videos).toEqual([])
    expect(stills.frames).toEqual([
      { atMs: 500, step: 0, screenshot: "screenshots/000-step-0.png" },
      { atMs: 2_000, step: 1, screenshot: "screenshots/001-step-1.png" },
    ])
    expect(frameAt(stills.frames, 100)?.step).toBe(0)
    expect(frameAt(stills.frames, 1_500)?.step).toBe(0)
    expect(frameAt(stills.frames, 2_500)?.step).toBe(1)
    expect(stills.marks.filter((mark) => mark.fault).map((mark) => mark.atMs)).toEqual([1_200])
  })

  it("names the step at a moment: the one running, else the last that started", () => {
    const { marks } = replay().videos[0] ?? { marks: [] }

    expect(stepAt(marks, 100)).toBeUndefined()
    expect(stepAt(marks, 400)).toBe(0)
    expect(stepAt(marks, 700)).toBe(0)
    expect(stepAt(marks, 1_500)).toBe(1)
  })

  it("opens a link at ?t= seconds into the player, or where #step-N starts", () => {
    const { marks, startMs } = replay().videos[0] ?? { marks: [], startMs: 0 }

    expect(linkedMoment({ search: "?t=1.5", hash: "" }, marks, startMs)).toBe(1_700)
    expect(linkedMoment({ search: "", hash: "#step-1" }, marks, startMs)).toBe(1_000)
    expect(linkedMoment({ search: "?t=-2", hash: "" }, marks, startMs)).toBeUndefined()
    expect(linkedMoment({ search: "", hash: "" }, marks, startMs)).toBeUndefined()
  })

  it("shades settling and the checks after the body, the checks up to the record's end", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the segments read times, phases and statuses
    const record = {
      ...RECORD,
      durationMs: 6_000,
      videos: undefined,
      steps: [
        phaseStep(0, "body", "0.300", 200),
        phaseStep(1, "settle", "1.000", 2_500),
        phaseStep(2, "checks", "3.600", 5),
      ],
    } as unknown as Parameters<typeof replayOf>[1]
    const { segments } = replayOf(DIR, record, timelineOf(RECORD))

    expect(segments).toEqual([
      { phase: "settle", label: "Settling", atMs: 1_000, endMs: 3_500, bad: false },
      { phase: "checks", label: "Checks", atMs: 3_500, endMs: 6_000, bad: false },
    ])
    expect(inTail(segments, 900)).toBe(false)
    expect(inTail(segments, 1_000)).toBe(true)
    expect(replay().segments).toEqual([])
  })

  it("reads the clock as minutes, seconds and tenths", () => {
    expect(clock(0)).toBe("0:00.0")
    expect(clock(1_250)).toBe("0:01.3")
    expect(clock(83_400)).toBe("1:23.4")
  })
})

/** A step of the popup run, started `at` seconds in (`1.000`), in tab `tab`. */
function tabStep(index: number, label: string, at: string, durationMs: number, tab: number) {
  return {
    index,
    label,
    status: "passed" as const,
    phase: "body" as const,
    startedAt: `2026-10-19T10:00:0${at}Z`,
    durationMs,
    tab,
  }
}

/** The steps as a video that began at `startedAt` marks them, on its own clock. */
function marksFrom(startedAt: string, steps: readonly ReturnType<typeof tabStep>[]) {
  const origin = Date.parse(startedAt)

  return steps.map((step) => {
    const startMs = Date.parse(step.startedAt) - origin

    return {
      kind: "step" as const,
      id: String(step.index),
      label: step.label,
      startMs,
      endMs: startMs + step.durationMs,
      bad: false,
    }
  })
}

/**
 * A test that connects an account: it clicks Connect in the app (tab 1), the provider's page opens
 * in a popup (tab 2) where it fills the email and clicks Allow, and the popup closes back to the app.
 */
function popupReplay() {
  const steps = [
    tabStep(0, "Connect", "0.300", 400, 1),
    tabStep(1, "Email", "1.000", 300, 2),
    tabStep(2, "Allow", "1.500", 500, 2),
    tabStep(3, "Connected", "2.100", 300, 1),
  ]
  const app = "2026-10-19T10:00:00.200Z"
  const popup = "2026-10-19T10:00:00.800Z"
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the replay reads times, steps and videos
  const record = {
    ...RECORD,
    durationMs: 4_000,
    steps,
    videos: [
      {
        file: "video/tab-1.webm",
        startedAt: app,
        durationMs: 3_800,
        tab: 1,
        marks: marksFrom(app, steps),
      },
      {
        file: "video/tab-2.webm",
        startedAt: popup,
        durationMs: 1_400,
        tab: 2,
        opener: 1,
        host: "accounts.provider.test",
        closed: true,
        marks: marksFrom(popup, steps),
      },
    ],
  } as unknown as Parameters<typeof replayOf>[1]

  return { replay: replayOf(DIR, record, timelineOf(RECORD)), steps }
}

describe("a record whose video was not saved", () => {
  it("says why for each tab, once per reason, and nothing when every video was kept", () => {
    const reason = "saving it failed: ENOSPC: no space left on device, write"

    expect(
      videoNotSaved({
        missing: [
          { kind: "video", cause: "failed", reason, tab: 1 },
          { kind: "video", cause: "failed", reason, tab: 1 },
          { kind: "screenshot", cause: "secret", reason: "a secret showed", step: 2 },
          { kind: "video", cause: "setting", reason: 'video is off (video: "off")' },
        ],
      }),
    ).toEqual([
      `Video not saved (tab 1): ${reason}`,
      'Video not saved: video is off (video: "off")',
    ])
    expect(videoNotSaved({})).toEqual([])
  })
})

describe("the player following the action across tabs", () => {
  it("shows each step in the video of the tab it ran in, and where the popup opened and closed", () => {
    const { replay: played } = popupReplay()

    expect(played.stepVideos).toEqual({ 0: 0, 1: 1, 2: 1, 3: 0 })
    expect(played.videos.map((video) => [video.tab, video.opener, video.host])).toEqual([
      [1, undefined, undefined],
      [2, 0, "accounts.provider.test"],
    ])
    expect(isPopup(played.videos, 1)).toBe(true)
    expect(isPopup(played.videos, 0)).toBe(false)
    expect(played.tabMarks).toEqual([
      { kind: "opened", label: "Popup opened: accounts.provider.test", atMs: 800, video: 1 },
      { kind: "closed", label: "Back to the app", atMs: 2_200, video: 0 },
    ])
  })

  it("moves to the popup's video for its steps, and back to the app's once it closes", () => {
    const { replay: played } = popupReplay()

    expect(followedVideo(played, 0, 400)).toBe(0)
    /* The popup opened during Connect, but the player moves when a step runs in it. */
    expect(followedVideo(played, 0, 900)).toBe(0)
    expect(followedVideo(played, 0, 1_100)).toBe(1)
    expect(followedVideo(played, 1, 1_600)).toBe(1)
    /* Allow is done and the popup is still closing: the player stays until a step moves on. */
    expect(followedVideo(played, 1, 2_050)).toBe(1)
    expect(followedVideo(played, 1, 2_150)).toBe(0)
    expect(followedVideo(played, 0, 2_600)).toBe(0)
  })

  it("goes back to the opener when the popup's video ends with no step in another tab", () => {
    const { replay: played } = popupReplay()
    const unmoved = { ...played, stepVideos: { ...played.stepVideos, 3: 1 } }

    expect(followedVideo(unmoved, 1, 2_150)).toBe(1)
    expect(followedVideo(unmoved, 1, 2_200)).toBe(0)
  })

  it("jumps to a step in its tab's video, badges the popup's steps, and lists the moves between", () => {
    const { replay: played, steps } = popupReplay()
    const transcript = transcriptOf(
      { steps: steps.map((step) => ({ ...step, kind: "locator" as const, api: "locator.click" })) },
      played,
    )

    expect(transcript.map((step) => [step.label, step.video, step.atMs, step.popup])).toEqual([
      ["Connect", 0, 300, undefined],
      ["Email", 1, 1_000, true],
      ["Allow", 1, 1_500, true],
      ["Connected", 0, 2_100, undefined],
    ])
    /* The check of the app started while the popup was closing; the move still goes above it. */
    expect(
      tabMovesOf(transcript, played.tabMarks).map((moves) => moves.map((mark) => mark.label)),
    ).toEqual([[], ["Popup opened: accounts.provider.test"], [], ["Back to the app"]])
  })

  it("keeps a record from before steps kept their tab on its first video", () => {
    const older = replay()

    expect(older.stepVideos).toEqual({ 0: 0, 1: 0 })
    expect(older.tabMarks).toEqual([])
    expect(followedVideo(older, 0, 1_500)).toBe(0)
  })
})

describe("serving a record's video", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "danwo-media-"))
    await mkdir(join(root, DIR, "video"), { recursive: true })
    await writeFile(join(root, DIR, "video", "tab-1.webm"), "0123456789")
    await writeFile(join(root, DIR, "record.json"), "{}")
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const path = "20261019-100000-aaaa/tests-pay/attempt-1/video/tab-1.webm"

  it("reads byte ranges: from-to, from to the end, and the last n bytes", () => {
    expect(byteRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 })
    expect(byteRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 })
    expect(byteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 })
    expect(byteRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 })
    expect(byteRange("bytes=6-2", 10)).toBeUndefined()
    expect(byteRange(null, 10)).toBeUndefined()
  })

  it("answers the whole file, or the range asked for", async () => {
    const whole = await serveMedia(root, path, new Request("http://dash/"))

    expect(whole.status).toBe(200)
    expect(whole.headers.get("content-type")).toBe("video/webm")
    expect(await whole.text()).toBe("0123456789")

    const part = await serveMedia(
      root,
      path,
      new Request("http://dash/", { headers: { range: "bytes=2-5" } }),
    )

    expect(part.status).toBe(206)
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(await part.text()).toBe("2345")
  })

  it("serves nothing but videos inside the runs folder", async () => {
    const request = new Request("http://dash/")

    expect(
      (await serveMedia(root, "20261019-100000-aaaa/tests-pay/attempt-1/record.json", request))
        .status,
    ).toBe(404)
    expect((await serveMedia(root, "../../etc/passwd.webm", request)).status).toBe(404)
    expect((await serveMedia(root, "missing/tab-1.webm", request)).status).toBe(404)
  })
})
