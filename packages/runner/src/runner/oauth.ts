import {
  createEmulator,
  type Emulator,
  type EmulatorDefinition,
  GOOGLE_HOSTS,
  google,
  type GoogleSeedConfig,
  MICROSOFT_HOSTS,
  microsoft,
  type MicrosoftSeedConfig,
  seedGoogle,
  seedMicrosoft,
  type Store,
} from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"

import { type Service, startServices } from "./services.ts"

export interface GoogleOptions {
  /** The app's OAuth clients and the users who can sign in; applied on start and after every reset. */
  readonly seed?: GoogleSeedConfig
}

export interface MicrosoftOptions {
  /** The app's registrations and the users who can sign in; applied on start and after every reset. */
  readonly seed?: MicrosoftSeedConfig
}

export interface OAuthService extends Service {
  readonly emulator: Emulator
}

/** A sign-in provider's emulator behind its own danwo proxy. */
export interface OAuthEnvironment<Name extends string> {
  readonly emulator: Emulator
  readonly proxy: Proxy
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

interface Provider<Seed> {
  readonly name: string
  readonly definition: EmulatorDefinition
  readonly hosts: readonly string[]
  readonly apply: (store: Store, seed: Seed) => void
}

/**
 * A sign-in emulator for `startServices`. It answers the provider's real hosts for both the
 * app's server calls and the browser's account chooser (the browser goes through the same
 * proxy), and sends no webhooks.
 */
function oauthService<Seed>(provider: Provider<Seed>, seed: Seed | undefined): OAuthService {
  const emulator = createEmulator(provider.definition)

  const apply = () => {
    if (seed) provider.apply(emulator.store, seed)
  }

  apply()

  return {
    name: provider.name,
    emulator,
    routes: [{ hosts: provider.hosts, handler: emulator.fetch }],
    fixtures: { [provider.name]: emulator },
    state: () => emulator.snapshot(),
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
    reset: () => services.reset(),
    fixtures,
    close: () => services.close(),
  }
}

const GOOGLE: Provider<GoogleSeedConfig> = {
  name: "google",
  definition: google,
  hosts: GOOGLE_HOSTS,
  apply: seedGoogle,
}

const MICROSOFT: Provider<MicrosoftSeedConfig> = {
  name: "microsoft",
  definition: microsoft,
  hosts: MICROSOFT_HOSTS,
  apply: seedMicrosoft,
}

/** Google sign-in for `startServices` (accounts.google.com and Google's token, userinfo and key hosts); gives tests the `google` fixture. */
export function googleService(options: GoogleOptions = {}): OAuthService {
  return oauthService(GOOGLE, options.seed)
}

/** Microsoft sign-in for `startServices` (login.microsoftonline.com and Graph `/me`); gives tests the `microsoft` fixture. */
export function microsoftService(options: MicrosoftOptions = {}): OAuthService {
  return oauthService(MICROSOFT, options.seed)
}

/** A worker-scoped Google sign-in emulator behind its own proxy; combine services with `startServices`. */
export function googleEnvironment(
  options: GoogleOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<GoogleEnvironment> {
  return oauthEnvironment("google", googleService(options), options)
}

/** A worker-scoped Microsoft sign-in emulator behind its own proxy; combine services with `startServices`. */
export function microsoftEnvironment(
  options: MicrosoftOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<MicrosoftEnvironment> {
  return oauthEnvironment("microsoft", microsoftService(options), options)
}
