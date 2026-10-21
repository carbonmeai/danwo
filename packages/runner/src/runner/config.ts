import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { WebhookFault } from "@danwo/emulators"
import type { DataFaultCatalogue } from "@danwo/matrix"
import type { OutboundCall, OutboundFault } from "@danwo/proxy"
import type { LanguageModel } from "ai"

import type { Budgets } from "../agent/budget.ts"
import type { ReadinessMode } from "../browser/readiness.ts"
import type { LintConfig } from "../lint/index.ts"
import type { VideoSetting } from "../record/video.ts"
import type { RelocationPolicy } from "../replay/policy.ts"
import type { EffectsSetting, SessionSecret } from "../session.ts"
import { DanwoError } from "../support/codes.ts"
import type { SessionArgs, SessionDefinition } from "../tests/types.ts"
import type { VisionSetting } from "../vision/desk.ts"
import type { EnvironmentContext, WorkerEnvironment } from "./environment.ts"
import type { ImpactConfig } from "./impact.ts"
import type { Isolation } from "./isolation.ts"
import { explainLoadError } from "./load-errors.ts"
import type { RecordMode, RecordOptions } from "./record.ts"
import type { Reporter } from "./reporting.ts"

/** What `danwo.config.ts` default-exports; every key is optional. */
export interface DanwoConfig {
  /** Where test files are found, relative to the config file; default the config's folder. */
  readonly testDir?: string
  /** Globs relative to `testDir`; default every `*.danwo.ts`. */
  readonly testMatch?: readonly string[]
  /** The app's URL when no environment provides one. */
  readonly baseUrl?: string
  /** Worker processes; default 1. Each runs one browser attempt at a time. */
  readonly workers?: number
  /** Extra attempts for a failing test; default 0. */
  readonly retries?: number
  /** One test attempt's deadline in milliseconds; default 60 000. */
  readonly timeout?: number
  /** The agent's model: an AI SDK model or a Vercel AI Gateway id. */
  readonly model?: LanguageModel
  /** The model `agent.assert` judges with; another provider than `model` is best. */
  readonly judge?: LanguageModel
  /**
   * Limits on what the agent spends, per step and per test: turns, model calls, dollars, wall time.
   * Default 25 turns a step. A step or test that runs out fails with `BUDGET_EXCEEDED`.
   */
  readonly budget?: Budgets
  /** Show the judge of `agent.assert` a screenshot besides the page's text (default false). */
  readonly judgeScreenshot?: boolean
  /**
   * When the agent may see the page as an image: `auto` (default) when the text view misses
   * something (a canvas, an unnamed button, a frame it cannot list), `always`, or `off`.
   * `{ mode, model }` names a model of its own for reading screenshots.
   */
  readonly vision?: VisionSetting
  /**
   * The replay cache; `dir` is relative to the config file. `replayOnly: true` makes every
   * `danwo test` run as `--replay-only`: no model is called, and a step with no recording that
   * replays fails with `REPLAY_MISSING`.
   */
  readonly cache?: { readonly dir: string; readonly replayOnly?: boolean }
  /** Values the model never sees; tests pass `secret(name)`. */
  readonly secrets?: Readonly<Record<string, SessionSecret>>
  /** Files tests may upload, by name; paths are relative to the config file. */
  readonly files?: Readonly<Record<string, string>>
  /**
   * Whether a replay looks for a recorded element that moved instead of handing the step back to
   * the model (default true). `danwo matrix` never relocates: its runs follow recordings exactly.
   */
  readonly relocate?: boolean
  /**
   * How replays find recorded elements: `similar-v1` (default) also takes the one element that
   * clearly matches a moved one, `exact` never does. The policy is part of every recording's key,
   * so changing it records the steps afresh. Takes precedence over `relocate`.
   */
  readonly relocation?: RelocationPolicy
  /**
   * Whether a replayed agent step must have the effects its recording had: the same elements
   * appearing and vanishing on the page, the same provider calls and webhooks behind it (default
   * true). `{ ignore: [...] }` leaves text matching any pattern out of page effects. An `act` call
   * can turn effects off for itself with `{ effects: false }`.
   */
  readonly effects?: EffectsSetting
  /**
   * What each step waits for after an action. `page+backend` (the default with an environment
   * that has a proxy): the page settles, then nothing the app started at the proxy or the webhook
   * senders is still in flight. `page`: the page alone. `off`: no waiting. `settle: true` also lets
   * the environment play out background work (webhooks on a manual clock) after every action, so
   * a test needs no `settle()` of its own. `capMs` bounds one wait (default 5000).
   */
  readonly readiness?:
    | ReadinessMode
    | { readonly mode?: ReadinessMode; readonly capMs?: number; readonly settle?: boolean }
  /**
   * What counts as the app failing during a step, besides 5xx responses from the app and uncaught
   * page errors: `console: true` (default false) adds console errors. A live agent step stops at
   * the first with `APP_ERROR`, or `PROVIDER_ERROR` when a provider call failed before it; a
   * step the app failed in is never kept as a recording.
   */
  readonly appErrors?: { readonly console?: boolean }
  /**
   * Saved sessions by name: each is set up once per worker and its browser state reused by every
   * test that names it (`test.use({ session })`), until the environment resets. The setup also
   * receives the environment's fixtures.
   */
  readonly sessions?: Readonly<Record<string, SessionDefinition<SessionArgs>>>
  /** Starts what a worker's tests run against (app, emulators, proxy); called once per worker. */
  readonly environment?: (context: EnvironmentContext) => Promise<WorkerEnvironment>
  /**
   * How much state tests share. `test` (default) starts every test, and every retry, from the
   * environment's seeded state: emulators back to their seeds, the clock to now, the proxy's log
   * and webhook queues empty, and data stores restored, with a file's `beforeAll` work and saved
   * sessions kept on top. `file` resets once per file, `none` never. A file or describe block can
   * choose its own with `test.use({ isolation })`. The app's own memory is reset only by the
   * environment's `restore` or `reset` (e.g. by calling a test-reset endpoint).
   */
  readonly isolation?: Isolation
  /**
   * The flight recorder: `always` (default) keeps what every run did under `.danwo/runs/<run>/`
   * with an HTML report; `on-failure` keeps failed runs only; `off` records nothing. As an object,
   * `{ mode, keepRuns }` also says how many of the newest runs keep their recordings (default 50).
   */
  readonly record?: RecordMode | RecordOptions
  /**
   * Video in the flight record, one per tab or the device's screen, with every step, call and
   * webhook on its clock: `on` (default) keeps it with every record kept; `retain-on-failure` films
   * every run and keeps the video of runs that did not pass (a matrix keeps failing and invalid
   * trials'); `off` films nothing. Secret fields show as dots, but a secret the app prints as
   * text is on screen: turn video off for suites that show one. As an object, `{ mode, cursor }`;
   * `cursor: false` films without the pointer drawn at each action.
   */
  readonly video?: VideoSetting
  /** Reporters told about every run besides the console, e.g. `github()` from `@danwo/github`. */
  readonly reporters?: readonly Reporter[]
  /**
   * How `danwo test --changed` maps the app's own source files to what tests touch: globs →
   * app paths (`/checkout`), provider hosts, calls or webhooks. Test files and what they import
   * need no rule; a change no rule or import explains selects every test.
   */
  readonly impact?: ImpactConfig
  /**
   * Integration lint over every run's provider calls and webhooks: per-rule levels by id
   * (`"stripe/idempotency-key": "error" | "warn" | "info" | "off"`) and which findings fail the
   * run (`failOn`, default `never`). `false` turns it off.
   */
  readonly lint?: LintConfig | false
  /** Fault catalogue for `danwo matrix`. */
  readonly matrix?: {
    /** Default `defaultOutboundFaults`: each provider's faults by host, plain HTTP failures elsewhere. */
    readonly outboundFaults?: (call: OutboundCall) => readonly OutboundFault[]
    readonly webhookFaults?: readonly WebhookFault[]
    /**
     * Faults on the app's own data calls, through the environment's `data` proxies. Default
     * `defaultDataFaults`: writes lost before or after the server ran them, slow, or failing to
     * serialize; COMMITs lost or failing; BEGINs meeting a database that is down or full; cache
     * commands lost, slow, or answered OOM, READONLY or LOADING.
     */
    readonly dataFaults?: DataFaultCatalogue
    /** Runs a faulted run again up to this many times while its fault never fires (default 0). */
    readonly rerunInvalid?: number
    /** Worker processes for `danwo matrix`; default `workers`, else one per core (at most 8). */
    readonly workers?: number
    /**
     * How long a faulted run's checks wait: at most `factor` times (default 3) as long as the same
     * check took in the clean run, and at least `floorMs` (default 1000). `false` keeps every
     * check's normal timeout.
     */
    readonly checkPace?: false | { readonly factor?: number; readonly floorMs?: number }
    /**
     * Race faults, each planned only where the clean run allows it; all on by default, `false`
     * turns every one off. `doubleSubmit`: each change-making request the page sends the app,
     * sent twice at once. `beforeRedirect`: a provider's webhooks delivered before the browser
     * lands back on the app. `webhookOrder`: two webhooks in a row delivered the other way round.
     * `slowThenRetry`: a payment provider's call held up to `ms` (default 3000) or until the app
     * gives up and retries, then processed anyway. Running a test by several people at once is
     * the test's own `concurrent` option.
     */
    readonly races?: false | RaceSettings
    /**
     * Most faulted trials a matrix runs (default 40). Past it the plan folds repeated routes and
     * statements into their first, keeps each target's most telling faults, then keeps races,
     * webhooks and writes ahead of reads. `--budget` and `--all` override it.
     */
    readonly budget?: number
  }
}

/** Which race faults `danwo matrix` plans; each is on unless set to `false`. */
export interface RaceSettings {
  readonly doubleSubmit?: boolean
  readonly beforeRedirect?: boolean
  readonly webhookOrder?: boolean
  readonly slowThenRetry?: false | { readonly ms?: number }
}

/** Types a project's config; returns it unchanged. */
export function defineConfig(config: DanwoConfig): DanwoConfig {
  return config
}

/** A project's config and where it lives; test paths and the cache resolve against `root`. */
export interface LoadedConfig {
  readonly config: DanwoConfig
  /** The config file, or undefined when the project has none. */
  readonly path: string | undefined
  readonly root: string
}

const CONFIG_FILES = ["danwo.config.ts", "danwo.config.mts", "danwo.config.js", "danwo.config.mjs"]

/** Folders from `start` up to the repository root (the folder holding `.git`) or the disk's root. */
function* foldersUp(start: string): Generator<string> {
  let folder = resolve(start)

  while (true) {
    yield folder

    const parent = dirname(folder)

    if (parent === folder || existsSync(join(folder, ".git"))) return

    folder = parent
  }
}

/** The nearest config file at or above `cwd`, inside the repository. */
export function nearestConfig(cwd: string): string | undefined {
  for (const folder of foldersUp(cwd)) {
    const file = CONFIG_FILES.map((name) => join(folder, name)).find((path) => existsSync(path))

    if (file !== undefined) return file
  }

  return undefined
}

function isConfig(value: unknown): value is DanwoConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Loads the project's config: `explicit` when given (relative to `cwd`), else the nearest
 * `danwo.config.*`. Node imports it directly, TypeScript included. Without one, the project is
 * `cwd` with every default.
 */
export async function loadConfig(cwd: string, explicit?: string): Promise<LoadedConfig> {
  const path = explicit === undefined ? nearestConfig(cwd) : resolve(cwd, explicit)

  if (path === undefined) return { config: {}, path: undefined, root: cwd }
  if (!existsSync(path)) throw new DanwoError("CONFIG_INVALID", `config file not found: ${path}`)

  const module: { default?: unknown } = await import(
    /* @vite-ignore */ pathToFileURL(path).href
  ).catch((error: unknown) => {
    throw explainLoadError(error, path, "config")
  })

  if (!isConfig(module.default)) {
    throw new DanwoError(
      "CONFIG_INVALID",
      `${path} must default-export a config object (defineConfig({...}))`,
    )
  }

  return { config: module.default, path, root: dirname(path) }
}
