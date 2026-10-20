/**
 * What a web session keeps for the flight recorder: a screenshot after each step, what the app
 * logged, and the screen at failure. The runner turns it into a run record (runner/record.ts).
 */
import type { Page } from "playwright-core"

import { LocatorError } from "./locate/index.ts"
import {
  type AppLogRecord,
  type AttemptPhase,
  captureEvidence,
  type FailureEvidence,
  type StepRecord,
  type StepRecorder,
  takeScreenshot,
} from "./record/index.ts"
import type { CapturedVideo } from "./record/video.ts"
import { redactCredentials, type SecretVault } from "./secrets/index.ts"

/** One screenshot is given this long; a page that will not paint is not worth holding a step for. */
const SCREENSHOT_TIMEOUT_MS = 5_000

export interface SessionFlight {
  /** Every step of the attempt, its labels and errors redacted. */
  steps(): readonly StepRecord[]
  /** Marks the part of the attempt that starts now (setup, body, settle, checks, teardown). */
  enter?(phase: AttemptPhase): void
  /** Runs the wait for background work as a `settle` step, keeping what `wait` says it waited on. */
  waiting?(wait: () => Promise<readonly string[]>): Promise<void>
  /** Console messages, page errors and navigations, each with its step. */
  appLog(): readonly AppLogRecord[]
  /** Step index → screenshot taken right after it, relative to the artifacts directory. */
  screenshots(): ReadonlyMap<number, string>
  /** Replaces every secret value the session knows. */
  redact(text: string): string
  /**
   * The screen when `error` ended the attempt: its redacted text and a masked screenshot (both
   * under the artifacts directory), the URL, and for a locator that matched nothing the nodes
   * closest to it. Call before the session closes; best effort, never throws.
   */
  captureFailure(error: unknown): Promise<FailureEvidence | undefined>
  /** Waits for screenshots still being taken. */
  settle(): Promise<void>
  /** Video the session recorded, complete once it has closed; none when it recorded no video. */
  videos?(): readonly CapturedVideo[]
}

export interface SessionFlightOptions {
  /** The page to capture: the active tab at the time. */
  readonly page: () => Page
  readonly vault: SecretVault
  readonly steps: StepRecorder
  readonly artifactsDir: string
  /** Take a screenshot after every step (otherwise only at failure). */
  readonly stepScreenshots: boolean
  /** The session's videos, once it has closed. */
  readonly videos?: () => readonly CapturedVideo[]
}

/** The session side of the flight recorder; feed `onStep` every step that ends. */
export function createSessionFlight(
  options: SessionFlightOptions,
): SessionFlight & { onStep(step: StepRecord): void } {
  const shots = new Map<number, string>()
  let queue: Promise<void> = Promise.resolve()
  /** A page showed a secret as text after some step: the video, which cannot hide it, is not kept. */
  let secretShown = false

  /** One at a time, in step order. */
  const screenshot = (step: number) => {
    queue = queue.then(async () => {
      if (options.page().isClosed()) return

      const path = await takeScreenshot({
        page: options.page(),
        dir: options.artifactsDir,
        path: `screenshots/${String(step).padStart(3, "0")}-step-${step}.png`,
        secrets: options.vault.values(),
        timeout: SCREENSHOT_TIMEOUT_MS,
        onSecretShown: () => {
          secretShown = true
        },
      })

      if (path !== undefined) shots.set(step, path)
    })
  }

  return {
    onStep(step) {
      /* A value check or the settle wait changes nothing on the page, so it gets no screenshot. */
      if (options.stepScreenshots && step.kind !== "check" && step.kind !== "settle")
        screenshot(step.index)
    },
    steps: () => options.steps.all(),
    enter: (phase) => options.steps.enter(phase),
    waiting: (wait) => options.steps.settle(wait),
    appLog: () => options.steps.appLogs(),
    screenshots: () => shots,
    redact: (text) => options.vault.redact(text),
    async captureFailure(error) {
      await queue

      /* The screen may show credentials the session was never given, so shapes are masked too. */
      const redact = (text: string) => redactCredentials(options.vault.redact(text))

      const evidence = await captureEvidence({
        page: options.page(),
        dir: options.artifactsDir,
        redact,
        secrets: options.vault.values(),
        timeout: SCREENSHOT_TIMEOUT_MS,
      }).catch(() => undefined)

      return withCandidates(evidence, error, redact)
    },
    settle: () => queue,
    videos: () => (secretShown ? [] : (options.videos?.() ?? [])),
  }
}

/** A locator that failed lists the elements nearest to what it asked for, redacted. */
function withCandidates(
  evidence: FailureEvidence | undefined,
  error: unknown,
  redact: (text: string) => string,
): FailureEvidence | undefined {
  if (!(error instanceof LocatorError) || error.candidates.length === 0) return evidence

  return { ...evidence, candidates: error.candidates.map(redact) }
}
