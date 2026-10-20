import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { byteRange, serveMedia } from "../src/modules/record/record-media.ts"
import {
  clock,
  frameAt,
  inTail,
  linkedMoment,
  mediaUrl,
  replayOf,
  stepAt,
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

describe("serving a record's video", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "danwo-media-"))
    await mkdir(join(root, DIR, "video"), { recursive: true })
    await writeFile(join(root, DIR, "video", "tab-1.webm"), "0123456789")
    await writeFile(join(root, DIR, "record.json"), "{}")
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
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
