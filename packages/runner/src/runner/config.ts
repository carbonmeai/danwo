import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { WebhookFault } from "@danwo/emulators"
import type { OutboundCall, OutboundFault } from "@danwo/proxy"
import type { LanguageModel } from "ai"

import type { SessionSecret } from "../session.ts"
import type { EnvironmentContext, WorkerEnvironment } from "./environment.ts"
import type { RecordMode } from "./record.ts"

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
  /** The replay cache; relative to the config file. */
  readonly cache?: { readonly dir: string }
  /** Values the model never sees; tests pass `secret(name)`. */
  readonly secrets?: Readonly<Record<string, SessionSecret>>
  /** Files tests may upload, by name; paths are relative to the config file. */
  readonly files?: Readonly<Record<string, string>>
  /**
   * Whether a replay looks for a recorded element that moved instead of handing the step back to
   * the model (default true). `danwo matrix` never relocates: its runs follow recordings exactly.
   */
  readonly relocate?: boolean
  /** Starts what a worker's tests run against (app, emulators, proxy); called once per worker. */
  readonly environment?: (context: EnvironmentContext) => Promise<WorkerEnvironment>
  /**
   * The flight recorder: `on-failure` (default) keeps what failed runs did under
   * `.danwo/runs/<run>/` with an HTML report; `always` keeps every run; `off` records nothing.
   */
  readonly record?: RecordMode
  /** Fault catalogue for `danwo matrix`. */
  readonly matrix?: {
    /** Default `defaultOutboundFaults`: each provider's faults by host, plain HTTP failures elsewhere. */
    readonly outboundFaults?: (call: OutboundCall) => readonly OutboundFault[]
    readonly webhookFaults?: readonly WebhookFault[]
    /** Runs a faulted run again up to this many times while its fault never fires (default 0). */
    readonly rerunInvalid?: number
  }
}

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
function nearestConfig(cwd: string): string | undefined {
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
  if (!existsSync(path)) throw new Error(`config file not found: ${path}`)

  const module: { default?: unknown } = await import(pathToFileURL(path).href)

  if (!isConfig(module.default)) {
    throw new Error(`${path} must default-export a config object (defineConfig({...}))`)
  }

  return { config: module.default, path, root: dirname(path) }
}
