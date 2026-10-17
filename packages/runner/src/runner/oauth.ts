import {
  createEmulator,
  type Emulator,
  type EmulatorDefinition,
  GOOGLE_HOSTS,
  google,
  type GoogleSeedConfig,
  ManualClock,
  MICROSOFT_HOSTS,
  microsoft,
  type MicrosoftSeedConfig,
  seedGoogle,
  seedMicrosoft,
} from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"

import { type Service, type Services, settleWebhooks, startServices } from "./services.ts"

/**
 * Seed data applied on start and after every reset. A function runs each time, so it can use
 * values only known once the app is up, such as its push or notification URL.
 */
export type Seed<Config> = Config | (() => Config | undefined)

export interface GoogleOptions {
  /** OAuth clients, users, and their Gmail, Calendar, Drive and Pub/Sub push data. */
  readonly seed?: Seed<GoogleSeedConfig>
}

export interface MicrosoftOptions {
  /** Registrations, users, and their Outlook mail, calendar events and OneDrive files. */
  readonly seed?: Seed<MicrosoftSeedConfig>
}

export interface OAuthService extends Service {
  readonly emulator: Emulator
  /** The emulator's clock; push deliveries and their retries run on it. */
  readonly clock: ManualClock
}

/** A Google or Microsoft emulator behind its own danwo proxy. */
export interface OAuthEnvironment<Name extends string> {
  readonly emulator: Emulator
  readonly proxy: Proxy
  /** Its push notifications, by service name, for `danwo matrix` to fault. */
  readonly webhooks: Services["webhooks"]
  /** Plays every pending push notification and retry to the end. */
  readonly settle: () => Promise<void>
  /** Emulator back to its seed, proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Fixtures for tests: the emulator under `Name` (`google`, `microsoft`), `proxy`, `settle`. */
  readonly fixtures: { readonly proxy: Proxy; readonly settle: () => Promise<void> } & {
    readonly [K in Name]: Emulator
  }
  close(): Promise<void>
}

export type GoogleEnvironment = OAuthEnvironment<"google">
export type MicrosoftEnvironment = OAuthEnvironment<"microsoft">

interface Provider<Config> {
  readonly name: string
  readonly definition: EmulatorDefinition
  readonly hosts: readonly string[]
  readonly apply: (emulator: Emulator, config: Config) => void
}

/** Whether a seed is given as a function to run on every apply. */
function isDeferred<Config>(seed: Seed<Config>): seed is () => Config | undefined {
  return typeof seed === "function"
}

/** The seed's config right now: the value itself, or what its function returns. */
function seedNow<Config>(seed: Seed<Config> | undefined): Config | undefined {
  if (seed === undefined) return undefined

  return isDeferred(seed) ? seed() : seed
}

/**
 * A Google or Microsoft emulator for `startServices`. It answers the provider's real hosts for
 * the app's server calls and the browser's account chooser alike (the browser goes through the
 * same proxy). Its push notifications go out as webhooks on a manual clock, so `settle` plays
 * them to the end and `danwo matrix` can fault them.
 */
function oauthService<Config>(
  provider: Provider<Config>,
  seed: Seed<Config> | undefined,
): OAuthService {
  const clock = new ManualClock(new Date())
  const emulator = createEmulator(provider.definition, { clock: clock.clock, timer: clock.timer })

  const apply = () => {
    const config = seedNow(seed)

    if (config) provider.apply(emulator, config)
  }

  apply()

  return {
    name: provider.name,
    emulator,
    clock,
    routes: [{ hosts: provider.hosts, handler: emulator.fetch }],
    fixtures: { [provider.name]: emulator },
    webhooks: emulator.webhooks,
    state: () => emulator.snapshot(),
    settle: () => settleWebhooks(emulator, clock),
    async reset() {
      emulator.reset()
      apply()
    },
    close: () => emulator.close(),
  }
}

async function oauthEnvironment<Name extends string>(
  name: Name,
  service: OAuthService,
  options: { readonly unmatched?: "passthrough" | "block" },
): Promise<OAuthEnvironment<Name>> {
  const services = await startServices([service], options)
  const { proxy } = services
  const settle = () => services.settle()
  // The mapped key is `name` itself, which TypeScript cannot see through a computed property.
  const fixtures = { [name]: service.emulator, proxy, settle } as OAuthEnvironment<Name>["fixtures"]

  return {
    emulator: service.emulator,
    proxy,
    webhooks: services.webhooks,
    settle,
    reset: () => services.reset(),
    fixtures,
    close: () => services.close(),
  }
}

const GOOGLE: Provider<GoogleSeedConfig> = {
  name: "google",
  definition: google,
  hosts: GOOGLE_HOSTS,
  apply: (emulator, config) => seedGoogle(emulator.store, config),
}

const MICROSOFT: Provider<MicrosoftSeedConfig> = {
  name: "microsoft",
  definition: microsoft,
  hosts: MICROSOFT_HOSTS,
  apply: (emulator, config) => seedMicrosoft(emulator, config),
}

/** Google for `startServices`: sign-in, Gmail, Calendar and Drive on Google's real hosts; gives tests the `google` fixture. */
export function googleService(options: GoogleOptions = {}): OAuthService {
  return oauthService(GOOGLE, options.seed)
}

/** Microsoft for `startServices`: sign-in and Graph mail, calendar, OneDrive and subscriptions; gives tests the `microsoft` fixture. */
export function microsoftService(options: MicrosoftOptions = {}): OAuthService {
  return oauthService(MICROSOFT, options.seed)
}

/** A worker-scoped Google emulator behind its own proxy; combine services with `startServices`. */
export function googleEnvironment(
  options: GoogleOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<GoogleEnvironment> {
  return oauthEnvironment("google", googleService(options), options)
}

/** A worker-scoped Microsoft emulator behind its own proxy; combine services with `startServices`. */
export function microsoftEnvironment(
  options: MicrosoftOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<MicrosoftEnvironment> {
  return oauthEnvironment("microsoft", microsoftService(options), options)
}
