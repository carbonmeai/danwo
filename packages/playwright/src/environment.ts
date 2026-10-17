/**
 * One Playwright worker's danwo environment: the same `environment()` a danwo project declares in
 * `danwo.config.ts` (or one passed inline), started once per worker, with the vault that redacts
 * the project's secrets from flight records.
 */
import { SecretVault } from "@danwo/runner"
import { type EnvironmentContext, loadConfig, type WorkerEnvironment } from "@danwo/runner/runner"

/** Starts what a worker's tests run against: app, emulators, proxy. */
export type EnvironmentFactory = (context: EnvironmentContext) => Promise<WorkerEnvironment>

export interface WorkerSetup {
  readonly env: WorkerEnvironment
  /** Knows the project's secret values, so records never show them. */
  readonly vault: SecretVault
}

export interface WorkerSetupOptions {
  /** A danwo config file, relative to `cwd`; default the nearest `danwo.config.*`. */
  readonly config?: string | undefined
  /** An environment to start instead of the config's. */
  readonly environment?: EnvironmentFactory | undefined
  readonly cwd: string
  readonly workerIndex: number
}

/** Loads the project's config and starts its environment for one worker. */
export async function startWorkerSetup(options: WorkerSetupOptions): Promise<WorkerSetup> {
  const loaded = await loadConfig(options.cwd, options.config)
  const factory = options.environment ?? loaded.config.environment

  if (factory === undefined) {
    throw new Error(
      `no danwo environment: give the danwoEnvironment option, or an environment() in ${loaded.path ?? "a danwo.config.ts"}`,
    )
  }

  const env = await factory({ workerIndex: options.workerIndex })

  return { env, vault: new SecretVault(loaded.config.secrets) }
}
