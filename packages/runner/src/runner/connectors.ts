/**
 * Nylas, Nango and Unipile as services: the platforms an app reaches its users' mailboxes,
 * calendars, CRMs and LinkedIn or WhatsApp inboxes through. Each answers its real hosts behind the
 * proxy, for the app's server and the browser's hosted connect pages alike.
 */
import {
  connectNangoBackends,
  NANGO_HOSTS,
  type NangoBackendName,
  nango,
  type NangoSeedConfig,
  NYLAS_HOSTS,
  nylas,
  type NylasSeedConfig,
  seedNango,
  seedNylas,
  seedUnipile,
  UNIPILE_HOSTS,
  unipile,
  type UnipileSeedConfig,
} from "@danwo/emulators"

import {
  type OAuthEnvironment,
  oauthEnvironment,
  type OAuthService,
  oauthService,
  type Provider,
  type Seed,
} from "./oauth.ts"
import { servicesLifecycle, startServices } from "./services.ts"

/** Options of `nylasService()` and `nylasEnvironment()`. */
export interface NylasOptions {
  /** API keys, grants (with their mail, events and contacts) and webhook subscriptions. */
  readonly seed?: Seed<NylasSeedConfig>
}

/** Options of `nangoService()` and `nangoEnvironment()`. */
export interface NangoOptions {
  /** Secret keys, integrations, connections, the webhook URL, proxy answers, actions and records. */
  readonly seed?: Seed<NangoSeedConfig>
  /**
   * The Google, Microsoft, Slack or GitHub services a connection's proxied calls go to, with the
   * connection's access token (seed it with one the backend issued). Integrations without one
   * answer from the seeded proxy answers.
   */
  readonly backends?: readonly OAuthService[]
}

/** Options of `unipileService()` and `unipileEnvironment()`. */
export interface UnipileOptions {
  /** Access tokens, connected accounts and webhook subscriptions (with their auth headers). */
  readonly seed?: Seed<UnipileSeedConfig>
}

export type NylasEnvironment = OAuthEnvironment<"nylas">
export type NangoEnvironment = OAuthEnvironment<"nango">
export type UnipileEnvironment = OAuthEnvironment<"unipile">

const NYLAS: Provider<NylasSeedConfig> = {
  name: "nylas",
  definition: nylas,
  hosts: NYLAS_HOSTS,
  apply: (emulator, config) => seedNylas(emulator.store, config),
}

const NANGO: Provider<NangoSeedConfig> = {
  name: "nango",
  definition: nango,
  hosts: NANGO_HOSTS,
  apply: (emulator, config) => seedNango(emulator.store, config),
}

const UNIPILE: Provider<UnipileSeedConfig> = {
  name: "unipile",
  definition: unipile,
  hosts: UNIPILE_HOSTS,
  apply: (emulator, config) => seedUnipile(emulator.store, config),
}

/**
 * Nylas for `startServices`: hosted auth and grants, mail, calendars and events, contacts, the
 * scheduler and signed webhooks on `api.us.nylas.com` and `api.eu.nylas.com`; gives tests the
 * `nylas` fixture. Read and act on it with `nylasApplication(nylas)`.
 */
export function nylasService(options: NylasOptions = {}): OAuthService {
  return oauthService(NYLAS, options.seed)
}

const NANGO_BACKENDS = new Set<string>(["google", "microsoft", "slack", "github"])

function isBackendName(name: string): name is NangoBackendName {
  return NANGO_BACKENDS.has(name)
}

/**
 * Nango for `startServices`: integrations, connect sessions and the hosted Connect UI, connections
 * whose tokens refresh on the emulator's clock, the proxy, actions, records and signed `auth`
 * webhooks on `api.nango.dev` and `connect.nango.dev`; gives tests the `nango` fixture. Read it and
 * revoke connections with `nangoProject(nango)`. List the `backends` before it.
 */
export function nangoService(options: NangoOptions = {}): OAuthService {
  const service = oauthService(NANGO, options.seed)

  for (const backend of options.backends ?? []) {
    if (!isBackendName(backend.name))
      throw new Error(
        `nango backends: ${backend.name} is not one of ${[...NANGO_BACKENDS].join(", ")}`,
      )

    connectNangoBackends(service.emulator, { [backend.name]: backend.emulator })
  }

  return service
}

/**
 * Unipile for `startServices`: hosted auth links, connected LinkedIn, WhatsApp and mail accounts,
 * chats, messages, mail and webhooks on every `*.unipile.com` DSN; gives tests the `unipile`
 * fixture. Act as the other side with `unipileWorkspace(unipile)`.
 */
export function unipileService(options: UnipileOptions = {}): OAuthService {
  return oauthService(UNIPILE, options.seed)
}

type Unrouted = { readonly unmatched?: "passthrough" | "block" }

/** A worker-scoped Nylas emulator behind its own proxy; combine services with `startServices`. */
export function nylasEnvironment(options: NylasOptions & Unrouted = {}): Promise<NylasEnvironment> {
  return oauthEnvironment("nylas", nylasService(options), options)
}

/** A worker-scoped Unipile emulator behind its own proxy; combine services with `startServices`. */
export function unipileEnvironment(
  options: UnipileOptions & Unrouted = {},
): Promise<UnipileEnvironment> {
  return oauthEnvironment("unipile", unipileService(options), options)
}

/** A worker-scoped Nango emulator behind its own proxy, with its backends on the same proxy. */
export async function nangoEnvironment(
  options: NangoOptions & Unrouted = {},
): Promise<NangoEnvironment> {
  const service = nangoService(options)
  const backends = options.backends ?? []

  if (backends.length === 0) return oauthEnvironment("nango", service, options)

  const services = await startServices([...backends, service], options)
  const lifecycle = servicesLifecycle(services)

  return {
    emulator: service.emulator,
    proxy: services.proxy,
    webhooks: services.webhooks,
    ...lifecycle,
    fixtures: {
      ...services.fixtures,
      nango: service.emulator,
      proxy: services.proxy,
      settle: lifecycle.settle,
    },
  }
}
