/** The Composio emulator as a service, optionally acting on the backend emulators it is given. */
import {
  COMPOSIO_HOSTS,
  type ComposioBackends,
  composio,
  type ComposioSeedConfig,
  connectComposioBackends,
  seedComposio,
} from "@danwo/emulators"

import {
  type OAuthEnvironment,
  oauthEnvironment,
  type OAuthService,
  oauthService,
  type Seed,
} from "./oauth.ts"
import { servicesLifecycle, startServices } from "./services.ts"

/** Options of `composioService()` and `composioEnvironment()`. */
export interface ComposioOptions {
  /** API keys, auth configs, connected accounts, triggers, the webhook subscription, tool results. */
  readonly seed?: Seed<ComposioSeedConfig>
  /**
   * The Google, Slack, GitHub or Microsoft services Composio's toolkits act on: accounts sign in
   * on their emulators' consent pages and tools change their state (a `GMAIL_SEND_EMAIL` lands in
   * the Google emulator's mailbox). Toolkits without one answer from seeds and samples.
   */
  readonly backends?: readonly OAuthService[]
}

/** What `composioEnvironment()` starts: Composio, and any backends, behind one proxy. */
export type ComposioEnvironment = OAuthEnvironment<"composio">

const BACKEND_NAMES = new Set(["google", "slack", "github", "microsoft"])

/** The backend emulators by provider, from the services given. */
function backendsOf(services: readonly OAuthService[]): ComposioBackends {
  for (const service of services)
    if (!BACKEND_NAMES.has(service.name))
      throw new Error(
        `composio backends: ${service.name} is not one of ${[...BACKEND_NAMES].join(", ")}`,
      )

  return Object.fromEntries(services.map((service) => [service.name, service.emulator]))
}

/**
 * Composio for `startServices`: toolkits and tools, tool execution, auth configs, connected
 * accounts with hosted connect links (the browser connects through the same proxy), triggers and
 * the project's signed webhooks; gives tests the `composio` fixture. Read accounts and tool runs,
 * and fire triggers, with `composioProject(composio)`; answer tools with `composioTools(composio)`.
 * List the `backends` before it when starting the services together.
 */
export function composioService(options: ComposioOptions = {}): OAuthService {
  const service = oauthService(
    {
      name: "composio",
      definition: composio,
      hosts: COMPOSIO_HOSTS,
      apply: (emulator, config) => seedComposio(emulator.store, config),
    },
    options.seed,
  )

  if (options.backends?.length)
    connectComposioBackends(service.emulator, backendsOf(options.backends))

  return service
}

/**
 * A worker-scoped Composio emulator behind its own proxy, with its backends on the same proxy;
 * combine services with `startServices` instead when the app talks to more.
 */
export async function composioEnvironment(
  options: ComposioOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<ComposioEnvironment> {
  const service = composioService(options)
  const backends = options.backends ?? []

  if (backends.length === 0) return oauthEnvironment("composio", service, options)

  const services = await startServices([...backends, service], options)
  const lifecycle = servicesLifecycle(services)

  return {
    emulator: service.emulator,
    proxy: services.proxy,
    webhooks: services.webhooks,
    ...lifecycle,
    fixtures: {
      ...services.fixtures,
      composio: service.emulator,
      proxy: services.proxy,
      settle: lifecycle.settle,
    },
  }
}
