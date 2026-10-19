/**
 * Several apps behind one proxy: a frontend, the API it calls, a worker, a local dev server such as
 * Inngest's. Each starts in dependency order with its own command, folder, environment and
 * readiness rule; environments can name the others' URLs; all of them run through the proxy, are
 * owned by the run (stopped with it, whatever happens) and have their output in the flight record.
 */

import { liveKeyWarnings, preloadWarnings } from "./app-checks.ts"
import { type AppCommand, type StartedApp, startApp } from "./app-environment.ts"
import type { WorkerEnvironment } from "./environment.ts"
import {
  type Service,
  type Services,
  servicesLifecycle,
  startServices,
  type UnroutedHosts,
  unroutedOf,
} from "./services.ts"

/** The other apps' URLs, by name, for wiring one app's environment to another's. */
export type StackUrls = Readonly<Record<string, string>>

/** One app of the stack. */
export interface StackApp extends Omit<AppCommand, "env"> {
  /** Names it in `dependsOn`, in other apps' environments and in the flight record. */
  readonly name: string
  /** Apps that must be ready before this one starts. */
  readonly dependsOn?: readonly string[]
  /**
   * More environment over the proxy's: fixed values, or built from the other apps' URLs, e.g.
   * `({ api }) => ({ VITE_API_URL: api })`. A NODE_OPTIONS here is joined with danwo's.
   */
  readonly env?:
    | Readonly<Record<string, string>>
    | ((urls: StackUrls) => Readonly<Record<string, string>>)
}

/** Options of `stackEnvironment()`. */
export interface StackEnvironmentOptions extends UnroutedHosts {
  /** The apps, started in `dependsOn` order (apps with nothing between them start together). */
  readonly apps: readonly StackApp[]
  /** Emulated providers behind the proxy every app goes through. */
  readonly services?: readonly (Service | Promise<Service>)[]
  /** The app the browser opens: its URL is the tests' `baseUrl`. Default the first app. */
  readonly baseUrl?: string
  /**
   * Live-looking provider keys an app would use against providers this run does not emulate:
   * `warn` (default) prints a warning per key (names only), `fail` refuses to start, `ignore`.
   */
  readonly secrets?: "warn" | "fail" | "ignore"
  /**
   * Put danwo's `node` shim first on each app's PATH (default true), so a start script that sets
   * its own NODE_OPTIONS still loads the preload. Apps that start without it are warned about.
   */
  readonly nodeShim?: boolean
}

/** The apps in start order, as batches whose members may start together. */
export function startOrder(apps: readonly StackApp[]): readonly (readonly StackApp[])[] {
  const names = new Set(apps.map((app) => app.name))

  for (const app of apps)
    for (const dependency of app.dependsOn ?? [])
      if (!names.has(dependency))
        throw new Error(
          `${app.name} depends on ${dependency}, which is not one of the stack's apps`,
        )

  const started = new Set<string>()
  const batches: StackApp[][] = []

  while (started.size < apps.length) {
    const batch = apps.filter(
      (app) => !started.has(app.name) && (app.dependsOn ?? []).every((d) => started.has(d)),
    )

    if (batch.length === 0)
      throw new Error(
        `the stack's dependsOn has a cycle among ${apps
          .filter((a) => !started.has(a.name))
          .map((a) => a.name)
          .join(", ")}`,
      )
    for (const app of batch) started.add(app.name)
    batches.push(batch)
  }

  return batches
}

/** One app's own environment, with the other apps' URLs filled in. */
function ownEnv(app: StackApp, urls: StackUrls): Readonly<Record<string, string>> {
  return typeof app.env === "function" ? app.env(urls) : (app.env ?? {})
}

/** Prints or throws the warnings, as `secrets` says. */
function report(warnings: readonly string[], mode: StackEnvironmentOptions["secrets"]): void {
  if (warnings.length === 0 || mode === "ignore") return
  if (mode === "fail") throw new Error(warnings.join("\n"))
  for (const warning of warnings) process.stderr.write(`danwo: ${warning}\n`)
}

/** What starting one app of the stack needs to know about the rest. */
interface StackContext {
  readonly options: StackEnvironmentOptions
  readonly services: Services
  readonly serviceList: readonly Service[]
  readonly urls: StackUrls
}

/** Starts one app through the proxy, after checking its environment for live keys. */
async function startOne(app: StackApp, context: StackContext): Promise<StartedApp> {
  const { options, services } = context
  const env = ownEnv(app, context.urls)
  const proxyEnv = services.proxy.env(process.env, { nodeShim: options.nodeShim ?? true })

  report(
    await liveKeyWarnings({
      app: app.name,
      cwd: app.cwd,
      env: { ...proxyEnv, ...env },
      overridden: new Set(Object.keys(env)),
      services: new Set(context.serviceList.map((service) => service.name)),
      passthrough: (options.unmatched ?? "passthrough") === "passthrough",
    }),
    options.secrets,
  )

  try {
    return await startApp({ ...app, env }, proxyEnv)
  } catch (error) {
    /* With several apps, "the app exited" says nothing: name the one that did. */
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`${app.name}: ${message.replace(/^the app /, "it ")}`, { cause: error })
  }
}

/** Warns about every started app's Node processes that run without the preload. */
async function preloadCheck(
  started: ReadonlyMap<string, StartedApp>,
  services: Services,
): Promise<string[]> {
  const warnings: string[] = []

  for (const [name, app] of started)
    if (app.pid !== undefined)
      warnings.push(...(await preloadWarnings(name, app.pid, services.proxy)))

  for (const warning of warnings) process.stderr.write(`danwo: ${warning}\n`)

  return warnings
}

/**
 * A worker environment for a stack of apps: the services behind one proxy, every app started
 * through it in `dependsOn` order, and the lifecycle `danwo matrix` needs. Apps keep running
 * between tests; resets put the services back to their seeds.
 */
export async function stackEnvironment(
  options: StackEnvironmentOptions,
): Promise<WorkerEnvironment> {
  if (options.apps.length === 0) throw new Error("stackEnvironment needs at least one app")

  const order = startOrder(options.apps)
  const pending = (options.services ?? []).map((service) => Promise.resolve(service))
  const serviceList = await Promise.all(pending)
  const services = await startServices(serviceList, unroutedOf(options))
  const urls: StackUrls = Object.fromEntries(options.apps.map((app) => [app.name, app.url]))
  const started = new Map<string, StartedApp>()
  const warnings: string[] = []

  const stopAll = async () => {
    for (const app of [...started.values()].toReversed()) await app.stop()
  }

  try {
    for (const batch of order)
      await Promise.all(
        batch.map(async (app) =>
          started.set(app.name, await startOne(app, { options, services, serviceList, urls })),
        ),
      )

    warnings.push(...(await preloadCheck(started, services)))
  } catch (error) {
    await stopAll()
    await services.close()
    throw error
  }

  const browserApp = options.baseUrl ?? options.apps[0]?.name ?? ""

  return {
    baseUrl: urls[browserApp] ?? options.apps[0]?.url,
    proxy: services.proxy,
    webhooks: services.webhooks,
    /* `apps`: every app's URL by name, for a test that reads a worker's state directly. */
    fixtures: { ...services.fixtures, apps: urls },
    logs: () => Object.fromEntries([...started].map(([name, app]) => [name, app.logs()])),
    notes: () => warnings,
    state: () => services.state(),
    ...servicesLifecycle(services),
    async close() {
      await stopAll()
      await services.close()
    },
  }
}
