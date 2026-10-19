/**
 * One attempt on a device: the same handles a web session gives a test (`screen`, `app`,
 * `expect`, `secret`, `mail`, `time`), backed by a `DeviceTarget` instead of a browser. The app is
 * reset and launched when the attempt opens; each action waits for the app and the services behind
 * it to settle; the flight recorder gets a screenshot after each step, the device log, and the
 * screen at failure.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve as resolvePath } from "node:path"

import type { CheckPace } from "../assert/pace.ts"
import type { Backend } from "../browser/readiness.ts"
import type { SessionFlight } from "../flight.ts"
import { LocatorError } from "../locate/failure.ts"
import { MailDesk } from "../mail/desk.ts"
import type { MailSource } from "../mail/index.ts"
import type { FailureEvidence } from "../record/index.ts"
import { StepRecorder } from "../record/index.ts"
import { ReplayStore } from "../replay/index.ts"
import { relocationOf } from "../replay/policy.ts"
import { redactCredentials, SecretVault, type SessionSecret } from "../secrets/index.ts"
import {
  effectsOptions,
  pacer,
  type SessionMail,
  type WebSession,
  type WebSessionOptions,
} from "../session.ts"
import { DanwoError } from "../support/codes.ts"
import { sessionTime, type TimeMachine, timeMachineOf } from "../time/index.ts"
import { visionModelOf, visionModeOf } from "../vision/desk.ts"
import { createDeviceAgent } from "./agent/agent.ts"
import { deviceExpect } from "./expect.ts"
import { type DeviceFilm, startDeviceFilm } from "./film.ts"
import { type DeviceContext, DeviceReader, deviceScreen } from "./locator.ts"
import type { DeviceForeground, DeviceNode, DeviceScreenReading, DeviceTarget } from "./types.ts"

/** The agent's settings, as a web session takes them. */
type AgentSettings = Pick<
  WebSessionOptions,
  | "model"
  | "judge"
  | "judgeScreenshot"
  | "vision"
  | "budget"
  | "transcriptBudget"
  | "agentContext"
  | "cache"
  | "replay"
  | "relocate"
  | "relocation"
  | "effects"
  | "screenshots"
>

/** Options of `openDeviceSession`. */
export interface DeviceSessionOptions extends AgentSettings {
  /** The app's backend, for invariants that read the app's own state (`app.baseUrl`). */
  readonly baseUrl?: string | undefined
  readonly projectRoot: string
  readonly secrets?: Readonly<Record<string, SessionSecret>>
  readonly mail?: readonly MailSource[]
  readonly time?: TimeMachine
  /** The services behind the app, to wait for after every action. */
  readonly backend?: Backend
  /** Where the flight recorder keeps screenshots and the screen at failure; nothing is kept without it. */
  readonly artifactsDir?: string
  /** A screenshot after every step (otherwise only at failure). */
  readonly stepScreenshots?: boolean
  /** Film the screen into `<artifactsDir>/video`, when the device can. */
  readonly video?: boolean
  readonly actionTimeout?: number
  readonly assertionTimeout?: number
  /** Check timeouts from this check's earlier passing runs, as on the web. */
  readonly checkPace?: CheckPace
}

/** A device session: a web session's handles, on a device. */
export type DeviceSession = WebSession & { readonly platform: "android" }

const DEFAULT_ACTION_MS = 15_000
const DEFAULT_ASSERTION_MS = 15_000
/** How long the services behind the app may take to go quiet after an action. */
const BACKEND_QUIET_MS = 5_000
/** How long the screen may keep changing after an action before the next step goes ahead anyway. */
const SCREEN_SETTLE_MS = 1_500
const SCREEN_POLL_MS = 120

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One reading's shape: every element's role, name and text, to tell when the screen stops changing. */
function signature(reading: DeviceScreenReading): string {
  return reading.nodes.map((node) => `${node.role}|${node.name}|${node.text}`).join("\n")
}

/** Waits for the services to go quiet, then for two readings in a row to match. */
function readiness(target: DeviceTarget, backend: Backend | undefined): () => Promise<void> {
  return async () => {
    await backend?.quiet(BACKEND_QUIET_MS)

    const deadline = Date.now() + SCREEN_SETTLE_MS
    let before = signature(await target.read())

    while (Date.now() < deadline) {
      await sleep(SCREEN_POLL_MS)

      const now = signature(await target.read())

      if (now === before) return
      before = now
    }
  }
}

/** The screen as indented lines, for the record of a failure. */
function screenText(reading: DeviceScreenReading, front: DeviceForeground): string {
  const depth = new Map<string, number>()
  const lines = reading.nodes.map((node: DeviceNode) => {
    const level = node.parent === undefined ? 0 : (depth.get(node.parent) ?? 0) + 1

    depth.set(node.ref, level)

    const id = node.testId === undefined ? "" : ` [testID=${node.testId}]`
    const name = node.name || node.text

    return `${"  ".repeat(level)}- ${node.role}${name ? ` "${name}"` : ""}${id}`
  })
  const header = front.browser
    ? `browser ${front.package} ${front.url ?? ""}`
    : `app ${front.package}`

  return [header.trim(), ...lines].join("\n")
}

/** The session's `toHaveScreenshot` baselines, and where a difference's images are kept. */
function shotsOf(
  options: DeviceSessionOptions,
  steps: StepRecorder,
): NonNullable<DeviceContext["shots"]> {
  let count = 0

  return {
    settings: {
      dir: resolvePath(options.projectRoot, options.screenshots?.dir ?? "__screenshots__"),
      update: options.screenshots?.update ?? "missing",
      artifactsDir: options.artifactsDir ?? join(tmpdir(), "danwo-device-shots"),
    },
    next: () => ++count,
    note: (event) => steps.event(event),
  }
}

/** The agent's settings as the session's options give them. */
function agentSettings(options: DeviceSessionOptions) {
  return {
    strict: options.replay?.mode === "strict-stop",
    relocation: relocationOf(options),
    model: options.model,
    judge: options.judge,
    context: options.agentContext,
    ...(options.judgeScreenshot !== undefined && { judgeScreenshot: options.judgeScreenshot }),
    ...(options.budget !== undefined && { budgets: options.budget }),
    ...(options.transcriptBudget !== undefined && { transcriptBudget: options.transcriptBudget }),
    ...effectsOptions(options),
    vision: {
      mode: visionModeOf(options.vision, options.model),
      model: visionModelOf(options.vision),
    },
  }
}

/** Where the session's recordings live, keyed by the app's package unless told otherwise. */
function deviceStore(target: DeviceTarget, options: DeviceSessionOptions): ReplayStore | undefined {
  const { cache } = options

  if (options.replay && !cache)
    throw new Error("openDeviceSession: `replay` needs `cache`, the recordings to replay")
  if (cache === undefined) return undefined

  return new ReplayStore({
    dir: cache.dir,
    mode: options.replay ? "read-only" : cache.mode,
    projectId: cache.projectId ?? "danwo",
    journey: cache.journey ?? "journey",
    appIdentity: cache.appIdentity ?? `android:${target.app}`,
    policy: relocationOf(options),
  })
}

/** The flight recorder's side of a device session. */
function deviceFlight(
  target: DeviceTarget,
  reader: DeviceReader,
  steps: StepRecorder,
  vault: SecretVault,
  options: DeviceSessionOptions,
  film: DeviceFilm | undefined,
): SessionFlight & { onStep(index: number): void } {
  const shots = new Map<number, string>()
  const dir = options.artifactsDir
  let queue: Promise<void> = Promise.resolve()

  const pullLogs = async () => {
    for (const line of (await target.logs?.()) ?? []) {
      steps.appLog({ at: line.at, level: line.level, source: "device-log", text: line.text })
    }
  }

  return {
    onStep(index) {
      queue = queue.then(async () => {
        await pullLogs().catch(() => undefined)
        if (dir === undefined || options.stepScreenshots !== true) return

        const path = join("screenshots", `${String(index).padStart(3, "0")}-step-${index}.png`)

        await mkdir(join(dir, "screenshots"), { recursive: true })
        if (await target.screenshot(join(dir, path)).catch(() => false)) shots.set(index, path)
      })
    },
    steps: () => steps.all(),
    appLog: () => steps.appLogs(),
    screenshots: () => shots,
    redact: (text) => vault.redact(text),
    async captureFailure(error) {
      await queue
      if (dir === undefined) return undefined

      return failureEvidence(target, reader, dir, error, vault).catch(() => undefined)
    },
    settle: () => queue,
    videos: () => film?.videos() ?? [],
  }
}

/** The screen when an attempt failed: its tree, a screenshot, what was in front, near matches. */
async function failureEvidence(
  target: DeviceTarget,
  reader: DeviceReader,
  dir: string,
  error: unknown,
  vault: SecretVault,
): Promise<FailureEvidence> {
  const redact = (text: string) => redactCredentials(vault.redact(text))
  const reading = await reader.read()
  const front = await target.foreground()
  const screen = "screen-at-failure.txt"
  const screenshot = join("screenshots", "failure.png")

  await mkdir(join(dir, "screenshots"), { recursive: true })
  await writeFile(join(dir, screen), redact(screenText(reading, front)))

  const shot = await target.screenshot(join(dir, screenshot)).catch(() => false)
  const candidates =
    error instanceof LocatorError && error.candidates.length > 0
      ? { candidates: error.candidates.map(redact) }
      : {}

  return {
    url: redact(front.url ?? `app://${front.package}`),
    screen,
    ...(shot && { screenshot }),
    ...candidates,
  }
}

/** `value`, or a failure naming the mail that lacked it. */
function needMail(to: string, what: string, value: string | undefined): string {
  if (value === undefined) throw new DanwoError("TEST_FAILED", `no mail to ${to} had ${what}`)

  return value
}

/** The session's mail: the codes and links in what the app sent. */
function deviceMail(desk: MailDesk, timeout: number): SessionMail {
  return {
    latest: (to) => desk.latest(to),
    code: async (to, options = {}) =>
      needMail(
        to,
        "a code",
        await desk.value(to, { kind: "code", digits: options.digits }, timeout),
      ),
    link: async (to, options = {}) =>
      needMail(to, "a link", await desk.value(to, { kind: "link", match: options.match }, timeout)),
    open: () =>
      Promise.reject(new DanwoError("CONFIG_INVALID", "mail.open is not supported on Android yet")),
  }
}

/** Opens an attempt on `target`: the app is reset and launched first. */
export async function openDeviceSession(
  target: DeviceTarget,
  options: DeviceSessionOptions,
): Promise<DeviceSession> {
  const vault = new SecretVault(options.secrets ?? {})
  const reader = new DeviceReader(target)
  let onStep: ((index: number) => void) | undefined
  const steps = new StepRecorder({
    projectRoot: options.projectRoot,
    redact: vault.redact,
    onEnd: (step) => onStep?.(step.index),
  })
  const ready = readiness(target, options.backend)
  const context: DeviceContext = {
    target,
    steps,
    secrets: { resolve: (secret) => vault.reveal(secret) },
    actionTimeout: options.actionTimeout ?? DEFAULT_ACTION_MS,
    assertionTimeout: options.assertionTimeout ?? DEFAULT_ASSERTION_MS,
    ready,
    ...(options.checkPace && { checkTimeout: pacer(options.checkPace, steps, vault.redact) }),
    shots: shotsOf(options, steps),
  }
  const film =
    options.video === true && options.artifactsDir !== undefined
      ? await startDeviceFilm(target, options.artifactsDir)
      : undefined
  const flight = deviceFlight(target, reader, steps, vault, options, film)
  const store = deviceStore(target, options)
  const desk = new MailDesk(options.mail ?? [])
  const stopped = new AbortController()
  const agent = createDeviceAgent({
    target,
    steps,
    vault,
    store,
    actionTimeout: context.actionTimeout,
    assertionTimeout: context.assertionTimeout,
    signal: stopped.signal,
    ready,
    mail: desk,
    ...agentSettings(options),
  })

  onStep = (index) => flight.onStep(index)

  /* A relaunch is kept in the record, next to the step it happened in. */
  const start = async () => {
    const { relaunched } = await target.startApp()

    if (relaunched !== undefined) {
      steps.appLog({
        at: new Date().toISOString(),
        level: "warn",
        source: "device-log",
        text: `danwo: ${target.app} ${relaunched}`,
      })
    }
  }

  await steps
    .run("app", "app.start", target.app, async () => {
      await start()
      await ready()
    })
    .catch(async (error: unknown) => {
      /* No session comes back to close, so the film stops here. */
      await film?.stop()
      throw error
    })

  return {
    platform: "android",
    screen: deviceScreen(context, reader),
    expect: deviceExpect,
    agent,
    app: {
      baseUrl: options.baseUrl ?? "",
      open: (path) =>
        steps.run("app", "app.open", path ?? target.app, async () => {
          if (path === undefined) await start()
          else
            await target.openLink(
              target.scheme ? `${target.scheme}://${path.replace(/^\//, "")}` : path,
            )
          await ready()
        }),
    },
    divergence: () => agent.diverged(),
    secret: (name) => vault.handle(name),
    mail: deviceMail(desk, context.actionTimeout),
    flight,
    browserState: () =>
      Promise.reject(
        new DanwoError("CONFIG_INVALID", "saved sessions are not supported on Android yet"),
      ),
    /* The device's own clock stays where it is; the services behind the app move. */
    time: sessionTime(
      options.time ?? timeMachineOf(undefined),
      undefined,
      (label, act) => steps.run("app", "time.travel", label, act),
      ready,
    ),
    async close() {
      /* A recording is written only once a later check confirmed what its step did. */
      await store?.settle((step) => steps.verifiedAfter(step))
      await flight.settle()
      stopped.abort()
      await agent.eyes.close()
      await film?.stop()
    },
  }
}
