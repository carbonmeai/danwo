import { clearWebhookFaults } from "@danwo/core"
import type { Emulator, ManualClock, WebhookDispatcher } from "@danwo/emulators"
import { type Proxy, type Route, startProxy } from "@danwo/proxy"

/**
 * One faked third party behind the worker's proxy: the hosts it answers (an emulator in-process
 * or an outside endpoint such as MiniStack), the fixtures it gives tests, and how it settles and
 * resets. `startServices` puts any mix of them behind one proxy.
 */
export interface Service {
  /** Names the service in fixtures' evidence and in `danwo matrix` labels (`stripe`, `s3`). */
  readonly name: string
  readonly routes: readonly Route[]
  readonly fixtures?: Readonly<Record<string, unknown>>
  /** Webhook delivery `danwo matrix` can fault. */
  readonly webhooks?: WebhookDispatcher | undefined
  /** What the flight recorder keeps of this service when a run ends (an emulator's snapshot). */
  state?(): unknown
  settle?(): Promise<void>
  reset?(): Promise<void>
  close(): Promise<void>
}

/** Services started together; its fields slot straight into a `WorkerEnvironment`. */
export interface Services {
  readonly proxy: Proxy
  /** Every webhook-delivering service's dispatcher, by service name; undefined when none deliver. */
  readonly webhooks: Readonly<Record<string, WebhookDispatcher>> | undefined
  /** Every service's fixtures, plus `proxy` and `settle`. */
  readonly fixtures: Readonly<Record<string, unknown>>
  /** Every service's `state()`, by service name. */
  state(): Readonly<Record<string, unknown>>
  /** Lets every service's background work finish. */
  settle(): Promise<void>
  /** Every service back to its seed; proxy log and fault rules cleared. */
  reset(): Promise<void>
  close(): Promise<void>
}

/**
 * Starts one proxy in front of `services`, e.g. a Stripe emulator, an S3 emulator and MiniStack
 * for the rest of AWS. Other hosts pass through unless `unmatched` is `block`.
 */
export async function startServices(
  services: readonly Service[],
  options: { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<Services> {
  const proxy = await startProxy({
    routes: services.flatMap((s) => s.routes),
    ...(options.unmatched && { unmatched: options.unmatched }),
  })
  const webhooks = webhooksByService(services)

  const settle = async () => {
    for (const service of services) await service.settle?.()
  }

  return {
    proxy,
    webhooks,
    fixtures: {
      ...Object.fromEntries(services.flatMap((s) => Object.entries(s.fixtures ?? {}))),
      proxy,
      settle,
    },
    state: () =>
      Object.fromEntries(services.flatMap((s) => (s.state ? [[s.name, s.state()] as const] : []))),
    settle,
    async reset() {
      for (const service of services) await service.reset?.()
      proxy.clear()
      proxy.setFault(undefined)
      clearWebhookFaults(webhooks)
    },
    async close() {
      await proxy.stop()
      for (const service of services) await service.close()
    },
  }
}

function webhooksByService(
  services: readonly Service[],
): Readonly<Record<string, WebhookDispatcher>> | undefined {
  const entries = services.flatMap((s) => (s.webhooks ? [[s.name, s.webhooks] as const] : []))

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** Plays every pending webhook delivery and retry of `emulator` to the end on `clock`. */
export async function settleWebhooks(emulator: Emulator, clock: ManualClock): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await emulator.webhooks?.idle()

    const next = clock.nextIn()

    if (next === undefined) {
      return
    }

    clock.advance(next)
  }

  throw new Error("webhook deliveries did not settle")
}
