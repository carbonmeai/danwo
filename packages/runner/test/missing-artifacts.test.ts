import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Proxy } from "@danwo/proxy"
import type { Page } from "playwright-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { TabFilm } from "../src/browser/video.ts"
import { createSessionFlight, type SessionFlight } from "../src/flight.ts"
import { type StepRecord, StepRecorder } from "../src/record/index.ts"
import { type MissingArtifact, missingLine, unexpectedlyMissing } from "../src/record/missing.ts"
import { takeScreenshot } from "../src/record/screenshots.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"
import { buildRecord, type RecordInput } from "../src/runner/record.ts"
import { renderReport } from "../src/runner/report-html.ts"
import { SecretVault } from "../src/secrets/index.ts"

const STARTED = "2026-10-22T10:00:00.000Z"
const NO_SPACE = "ENOSPC: no space left on device, write"

/** A page whose video fails to save as `saveAs` says, and whose text shows a secret when `shows`. */
class FakePage extends EventEmitter {
  private readonly saveAs: () => Promise<void>
  private readonly shows: boolean

  constructor(saveAs: () => Promise<void>, shows = false) {
    super()
    this.saveAs = saveAs
    this.shows = shows
  }

  url = () => "http://app.test/"
  isClosed = () => false
  mainFrame = () => undefined
  opener = () => Promise.resolve(null)
  video = () => ({ saveAs: this.saveAs })
  evaluate = () => Promise.resolve(this.shows)
  locator = () => ({})
  screenshot = () =>
    Promise.reject(new Error("page.screenshot: Timeout 5000ms exceeded.\nCall log:"))
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the film and the screenshot read only these
const asPage = (page: FakePage) => page as unknown as Page

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-missing-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("a video that is not saved", () => {
  it("says the save failed, and why, instead of leaving the tab out silently", async () => {
    const film = new TabFilm(dir)

    film.watch(asPage(new FakePage(() => Promise.reject(new Error(NO_SPACE)))))
    await film.save(Date.now())

    expect(film.videos()).toEqual([])
    expect(film.missing()).toEqual([
      { kind: "video", cause: "failed", reason: `saving it failed: ${NO_SPACE}`, tab: 1 },
    ])
  })

  it("is lost with why when the browser did not close", () => {
    const film = new TabFilm(dir, "bob")

    film.watch(asPage(new FakePage(() => Promise.resolve())))
    film.lose("the browser did not close, so the video was never finished: Target closed")

    expect(film.missing()).toEqual([
      expect.objectContaining({ cause: "failed", tab: 1, user: "bob" }),
    ])
  })
})

/** Takes a screenshot of `page`, noting in `missed` why it was not taken. */
const screenshotOf = (page: FakePage, missed: string[]) =>
  takeScreenshot({
    page: asPage(page),
    dir,
    path: "screenshots/001.png",
    secrets: ["hunter2-secret"],
    timeout: 5_000,
    onMissed: (cause, reason) => missed.push(`${cause}: ${reason}`),
  })

describe("a screenshot that is not taken", () => {
  it("says a secret showed on the page, or what failed, on its first line", async () => {
    const missed: string[] = []

    expect(await screenshotOf(new FakePage(() => Promise.resolve(), true), missed)).toBeUndefined()
    expect(await screenshotOf(new FakePage(() => Promise.resolve()), missed)).toBeUndefined()
    expect(missed).toEqual([
      "secret: a secret showed on the page as text",
      "failed: taking it failed: page.screenshot: Timeout 5000ms exceeded.",
    ])
  })
})

describe("the session's missing artifacts", () => {
  it("withholds the video once a secret showed as text, and says so for each tab", async () => {
    const page = new FakePage(() => Promise.resolve(), true)
    const ended: { onStep?: (step: StepRecord) => void } = {}
    const steps = new StepRecorder({
      projectRoot: process.cwd(),
      redact: (text) => text,
      onEnd: (step) => ended.onStep?.(step),
    })
    const flight = createSessionFlight({
      page: () => asPage(page),
      vault: new SecretVault({ password: "hunter2-secret" }),
      steps,
      artifactsDir: dir,
      stepScreenshots: true,
      videos: () => [{ file: "video/tab-1.webm", startedAt: STARTED, durationMs: 10, tab: 1 }],
    })

    ended.onStep = (step) => flight.onStep(step)
    await steps.run("locator", "locator.click", "Show key", () => Promise.resolve())
    await flight.settle()

    expect(flight.videos?.()).toEqual([])
    expect(flight.missing?.()).toEqual([
      {
        kind: "screenshot",
        cause: "secret",
        reason: "a secret showed on the page as text",
        step: 0,
      },
      {
        kind: "video",
        cause: "secret",
        reason: "a secret showed on the page as text, which video cannot hide",
        tab: 1,
      },
    ])
  })
})

/** A session that kept nothing: it filmed one tab under `video`, and lost what `missing` says. */
function session(missing: readonly MissingArtifact[], filmed = true): SessionFlight {
  return {
    steps: () => [],
    appLog: () => [],
    screenshots: () => new Map(),
    redact: (text) => text.replaceAll("hunter2-secret", "[secret password]"),
    captureFailure: () => Promise.resolve(undefined),
    settle: () => Promise.resolve(),
    videos: () =>
      filmed ? [{ file: "video/tab-1.webm", startedAt: STARTED, durationMs: 10, tab: 1 }] : [],
    missing: () => missing,
  }
}

function input(flight: SessionFlight, extra: Partial<RecordInput> = {}): RecordInput {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the recorder reads only the exchange log
  const proxy = { exchanges: () => [], sockets: () => [] } as unknown as Proxy
  const env: WorkerEnvironment = { proxy, close: () => Promise.resolve() }

  return {
    test: "tests/pay.danwo.ts › pays",
    run: { kind: "test", attempt: 1 },
    status: "passed",
    error: undefined,
    stopped: undefined,
    divergence: undefined,
    notes: [],
    durationMs: 10,
    flight: { session: flight, failure: undefined, startedAt: STARTED },
    env,
    mark: { exchanges: 0, deliveries: 0 },
    ...extra,
  }
}

describe("missing artifacts in the flight record and the report", () => {
  const lost: MissingArtifact = {
    kind: "video",
    cause: "failed",
    reason: `saving it failed: ${NO_SPACE}`,
    tab: 1,
  }

  it("keeps a lost video's reason in the record, redacted, and the report shows it", () => {
    const record = buildRecord(
      input(session([{ ...lost, reason: `${lost.reason} (hunter2-secret)` }], false), {
        video: true,
      }),
    )

    expect(record.missing).toEqual([{ ...lost, reason: `${lost.reason} ([secret password])` }])

    const html = renderReport("run", [{ record, dir: "pays/attempt-1", screen: undefined }])

    expect(html).toContain(`Video not saved (tab 1): saving it failed: ${NO_SPACE}`)
  })

  it("says the video setting left a passing run's video out", () => {
    const reason = 'video is kept only for runs that fail (video: "retain-on-failure")'
    const record = buildRecord(input(session([]), { video: false, videoLeftOut: reason }))

    expect(record.missing).toEqual([{ kind: "video", cause: "setting", reason, tab: 1 }])
    expect(record.missing?.filter(unexpectedlyMissing)).toEqual([])
  })

  it("says video is off when nothing was filmed", () => {
    const reason = 'video is off (video: "off")'
    const record = buildRecord(
      input(session([], false), { status: "failed", video: false, videoLeftOut: reason }),
    )

    expect(record.missing).toEqual([{ kind: "video", cause: "setting", reason }])
  })

  it("warns about lost artifacts in one line, without failing the run", () => {
    const shot: MissingArtifact = {
      kind: "screenshot",
      cause: "failed",
      reason: "taking it failed: Timeout 5000ms exceeded.",
      step: 3,
    }

    expect(missingLine([])).toBeUndefined()
    expect(
      missingLine([
        { test: "pays", missing: lost },
        { test: "refunds", missing: shot },
      ]),
    ).toBe(
      `danwo: 1 video and 1 screenshot were not saved (the run's result stands): pays, the video of tab 1: saving it failed: ${NO_SPACE}; refunds, step 3's screenshot: taking it failed: Timeout 5000ms exceeded. Each record's \`missing\` says why.`,
    )
  })
})
