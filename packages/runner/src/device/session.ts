/**
 * One attempt on a device: the same handles a web session gives a test (`screen`, `app`,
 * `expect`, `secret`, `mail`, `time`), backed by a `DeviceTarget` instead of a browser. The app is
 * reset and launched when the attempt opens; each action waits for the app and the services behind
 * it to settle; the flight recorder gets a screenshot after each step, the device log, and the
 * screen at failure.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Agent } from "../agent/index.ts"
import type { Backend } from "../browser/readiness.ts"
import type { SessionFlight } from "../flight.ts"
import { LocatorError } from "../locate/failure.ts"
import { MailDesk } from "../mail/desk.ts"
import type { MailSource } from "../mail/index.ts"
import type { FailureEvidence } from "../record/index.ts"
import { StepRecorder } from "../record/index.ts"
import { redactCredentials, SecretVault, type SessionSecret } from "../secrets/index.ts"
import type { SessionMail, WebSession } from "../session.ts"
import { DanwoError } from "../support/codes.ts"
import { sessionTime, type TimeMachine, timeMachineOf } from "../time/index.ts"
import { deviceExpect } from "./expect.ts"
import { type DeviceContext, DeviceReader, deviceScreen } from "./locator.ts"
import type { DeviceForeground, DeviceNode, DeviceScreenReading, DeviceTarget } from "./types.ts"

/** Options of `openDeviceSession`. */
export interface DeviceSessionOptions {
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
  readonly actionTimeout?: number
  readonly assertionTimeout?: number
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

function refuseAgent(): Promise<never> {
  return Promise.reject(
    new DanwoError(
      "CONFIG_INVALID",
      "the agent is not available on Android yet; use screen locators",
    ),
  )
}

/** The agent is web-only for now: every call says so. */
function webOnlyAgent(): Agent {
  return { act: refuseAgent, extract: refuseAgent, assert: refuseAgent, waitFor: refuseAgent }
}

/** The flight recorder's side of a device session. */
function deviceFlight(
  target: DeviceTarget,
  reader: DeviceReader,
  steps: StepRecorder,
  vault: SecretVault,
  options: DeviceSessionOptions,
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
  }
  const flight = deviceFlight(target, reader, steps, vault, options)

  onStep = (index) => flight.onStep(index)
  await steps.run("app", "app.start", target.app, async () => {
    await target.startApp()
    await ready()
  })

  return {
    platform: "android",
    screen: deviceScreen(context, reader),
    expect: deviceExpect,
    agent: webOnlyAgent(),
    app: {
      baseUrl: options.baseUrl ?? "",
      open: (path) =>
        steps.run("app", "app.open", path ?? target.app, async () => {
          if (path === undefined) await target.startApp()
          else
            await target.openLink(
              target.scheme ? `${target.scheme}://${path.replace(/^\//, "")}` : path,
            )
          await ready()
        }),
    },
    divergence: () => undefined,
    secret: (name) => vault.handle(name),
    mail: deviceMail(new MailDesk(options.mail ?? []), context.actionTimeout),
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
      await flight.settle()
    },
  }
}
