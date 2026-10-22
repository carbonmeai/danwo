/**
 * A live session's process: the MCP server forks one per open session. It starts the project's
 * environment as a worker would (app, emulators, proxy), then opens a browser behind the proxy, or
 * drives the environment's own device, and answers the server's calls one at a time until it is
 * closed, or the server goes away.
 */
import { join } from "node:path"

import { type BrowserConfig, launchBrowser, SecretVault } from "@danwo/runner"
import {
  backendOf,
  createRedactor,
  FaultBench,
  loadConfig,
  type WorkerEnvironment,
} from "@danwo/runner/runner"
import type { Browser } from "playwright-core"

import type { ActionCall, SessionDesk } from "./desk.ts"
import { DeviceDesk } from "./device.ts"
import { EmulatorDesk } from "./emulators.ts"
import { PageDesk } from "./page.ts"
import {
  isSessionRequest,
  type OpenRequest,
  type SessionAnswer,
  type SessionCall,
  type SessionMessage,
} from "./protocol.ts"

interface Live {
  readonly env: WorkerEnvironment | undefined
  /** The session's browser; none when it drives a device. */
  readonly browser: Browser | undefined
  readonly page: SessionDesk
  readonly emulators: EmulatorDesk
  readonly faults: FaultBench
}

type PageCall = Extract<
  SessionCall,
  {
    kind:
      | "snapshot"
      | "check_locator"
      | "screenshot"
      | "start_recording"
      | "stop_recording"
      | "tabs"
  }
>
type ServiceCall = Extract<
  SessionCall,
  { kind: "emulator_state" | "exchanges" | "deliver_webhooks" | "inject_fault" | "clear_faults" }
>

const ACTIONS = new Set<string>([
  "click",
  "hover",
  "fill",
  "fill_secret",
  "press",
  "select",
  "check",
  "navigate",
  "upload",
  "drag",
  "switch_tab",
  "close_tab",
  "dialog",
  "back",
  "scroll",
  "tap_at",
])
const PAGE_CALLS = new Set<string>([
  "snapshot",
  "check_locator",
  "screenshot",
  "start_recording",
  "stop_recording",
  "tabs",
])

let live: Live | undefined
let queue: Promise<unknown> = Promise.resolve()

function send(message: SessionMessage): Promise<void> {
  return new Promise((resolve) => {
    if (process.send === undefined || !process.connected) {
      resolve()

      return
    }

    process.send(message, () => resolve())
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Loaded = Awaited<ReturnType<typeof loadConfig>>

/** Where a session's recordings go, and how answers name the folder. */
function recordDir(root: string, id: string) {
  return { path: join(root, ".danwo", "sessions", id), shown: `.danwo/sessions/${id}/` }
}

async function open(request: OpenRequest): Promise<SessionAnswer> {
  const loaded = await loadConfig(request.place.cwd, request.place.config)
  const env = await loaded.config.environment?.({ workerIndex: request.slot })

  try {
    return request.device
      ? await openDevice(request, loaded, env)
      : await openBrowser(request, loaded, env)
  } catch (error) {
    await env?.close().catch(() => undefined)
    throw error
  }
}

/** Opens the session on the environment's device: the app afresh, no browser. */
async function openDevice(
  request: OpenRequest,
  loaded: Loaded,
  env: WorkerEnvironment | undefined,
): Promise<SessionAnswer> {
  const target = env?.device

  if (target === undefined)
    throw new Error(
      "the project's environment has no device: device: true drives env.device, e.g. withIosDevice(…) or withAndroidDevice(…) in danwo.config.ts's environment()",
    )

  const vault = new SecretVault(loaded.config.secrets)
  const redactor = createRedactor(vault.redact)
  const opened = await DeviceDesk.open(
    {
      target,
      vault,
      redact: (text) => redactor.text(text),
      backend: backendOf(env),
      recordDir: recordDir(loaded.root, request.id),
    },
    request.path,
  )

  live = {
    env,
    browser: undefined,
    page: opened.desk,
    emulators: new EmulatorDesk(env, redactor),
    faults: new FaultBench(env?.proxy, env?.webhooks),
  }

  return { text: `session ${request.id} is open.\n${opened.text}` }
}

/** Opens the session in a browser behind the environment's proxy. */
async function openBrowser(
  request: OpenRequest,
  loaded: Loaded,
  env: WorkerEnvironment | undefined,
): Promise<SessionAnswer> {
  const baseUrl = env?.baseUrl ?? loaded.config.baseUrl

  if (baseUrl === undefined)
    throw new Error("the project has no baseUrl: set one in danwo.config.ts or its environment")

  const proxy = env?.proxy && { url: env.proxy.url, caSpki: env.proxy.caSpki }
  const browser = await launchBrowser({ ...(proxy && { proxy }), headless: true })

  try {
    return await start(request, {
      env,
      browser,
      baseUrl,
      root: loaded.root,
      secrets: loaded.config.secrets,
      files: loaded.config.files,
      browserConfig: loaded.config.browser,
    })
  } catch (error) {
    await browser.close().catch(() => undefined)
    throw error
  }
}

interface Started {
  readonly env: WorkerEnvironment | undefined
  readonly browser: Browser
  readonly baseUrl: string
  readonly root: string
  readonly secrets: ConstructorParameters<typeof SecretVault>[0]
  readonly files: Readonly<Record<string, string>> | undefined
  /** The config's `browser` key, whose context options the session's browser opens with. */
  readonly browserConfig: BrowserConfig | undefined
}

/** Opens the session's page on the started environment and browser. */
async function start(request: OpenRequest, started: Started): Promise<SessionAnswer> {
  const vault = new SecretVault(started.secrets)
  const redactor = createRedactor(vault.redact)
  const opened = await PageDesk.open(
    {
      browser: started.browser,
      baseUrl: started.baseUrl,
      vault,
      redact: (text) => redactor.text(text),
      root: started.root,
      files: started.files,
      contextOptions: started.browserConfig?.contextOptions,
      recordDir: recordDir(started.root, request.id),
    },
    request.path,
  )
  const { env } = started

  live = {
    env,
    browser: started.browser,
    page: opened.desk,
    emulators: new EmulatorDesk(env, redactor),
    faults: new FaultBench(env?.proxy, env?.webhooks),
  }

  return { text: `session ${request.id} is open.\n${opened.text}` }
}

function arm(session: Live, fault: string): string {
  const armed = session.faults.arm(fault)
  const when = armed.nth === 1 ? "the next" : `match #${armed.nth} of`
  const what = armed.target === "outbound" ? `call to ${armed.route}` : `delivery of ${armed.topic}`

  return `armed: ${armed.label}. It fires once, on ${when} ${what}; exchanges and deliver_webhooks show it as [fault: …].`
}

function clearFaults(session: Live): string {
  const left = session.faults.clear()

  return left === 0 ? "no faults were armed" : `cleared ${left} armed fault(s) that had not fired`
}

function isAction(call: SessionCall): call is ActionCall {
  return ACTIONS.has(call.kind)
}

function isPageCall(call: SessionCall): call is PageCall {
  return PAGE_CALLS.has(call.kind)
}

/** The page or device's own calls, beyond actions. */
function pageCall(page: SessionDesk, call: PageCall): Promise<string | SessionAnswer> {
  switch (call.kind) {
    case "snapshot":
      return page.snapshot()
    case "check_locator":
      return page.check(call.locator)
    case "screenshot":
      return page.screenshot(call.target, call.fullPage)
    case "start_recording":
      return page.startRecording(call.video)
    case "tabs":
      return page.tabList()
    default:
      return page.stopRecording()
  }
}

/** Calls on the services behind the app: emulators, proxy and faults. */
async function serviceCall(session: Live, call: ServiceCall): Promise<string> {
  switch (call.kind) {
    case "emulator_state":
      return session.emulators.state(call.emulator)
    case "exchanges":
      return session.emulators.exchanges(call.from, call.bodies)
    case "deliver_webhooks":
      return session.emulators.deliver()
    case "inject_fault":
      return arm(session, call.fault)
    default:
      return clearFaults(session)
  }
}

function handle(
  session: Live,
  call: Exclude<SessionCall, { kind: "close" }>,
): Promise<string | SessionAnswer> {
  if (isAction(call)) return session.page.act(call)
  if (isPageCall(call)) return pageCall(session.page, call)

  return serviceCall(session, call)
}

async function shutdown(): Promise<void> {
  const session = live

  live = undefined
  if (session === undefined) return

  await session.page.close()
  await session.browser?.close().catch(() => undefined)
  await session.env?.close().catch(() => undefined)
}

async function answer(call: SessionCall): Promise<SessionAnswer> {
  if (call.kind === "close") {
    await shutdown()

    return { text: "session closed" }
  }

  if (live === undefined) throw new Error("the session is not open")

  const result = await handle(live, call)

  return typeof result === "string" ? { text: result } : result
}

async function opening(request: OpenRequest): Promise<void> {
  try {
    await send({ type: "opened", answer: await open(request) })
  } catch (error) {
    await send({ type: "failed", message: messageOf(error) })
    await shutdown()
    process.exit(1)
  }
}

process.on("message", (request: unknown) => {
  if (!isSessionRequest(request)) return

  if (request.type === "open") {
    void opening(request)

    return
  }

  queue = queue.then(async () => {
    try {
      await send({ type: "answer", seq: request.seq, answer: await answer(request.call) })
    } catch (error) {
      await send({ type: "error", seq: request.seq, message: messageOf(error) })
    }

    if (request.call.kind === "close") process.exit(0)
  })
})

/* The server went away: close everything this session started. */
process.on("disconnect", () => {
  void shutdown().finally(() => process.exit(0))
})
