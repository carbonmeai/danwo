import type { Emulator, ManualClock, StoreSnapshot, WebhookDispatcher } from "@danwo/emulators"
import { clearWebhookFaults } from "@danwo/matrix"
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
  /**
   * Moves the service's time forward by `ms`, running what falls due on the way in order
   * (renewals, retries, expiries) and letting each step's deliveries land before the next.
   */
  travel?(ms: number): Promise<void>
  reset?(): Promise<void>
  /** Keeps the state it is in now (just reset), for `restore` to return to. */
  snapshot?(): Promise<void>
  /** Back to the kept state, faster than a reset; services without one are reset instead. */
  restore?(): Promise<void>
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
  /** Moves the apps' clocks (through the proxy) and every service's time forward by `ms`. */
  travel(ms: number): Promise<void>
  /** Every service back to its seed; proxy log, fault rules and the apps' clock offset cleared. */
  reset(): Promise<void>
  /** Keeps every service's state now, for `restore`. */
  snapshot(): Promise<void>
  /** Every service back to its kept state (or its seed, when it keeps none); log and faults cleared. */
  restore(): Promise<void>
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

  const clearRun = async () => {
    proxy.clear()
    proxy.setFault(undefined)
    clearWebhookFaults(webhooks)
    await proxy.clock.setOffset(0)
  }

  const travel = async (ms: number) => {
    await proxy.clock.setOffset(proxy.clock.offset() + ms)
    for (const service of services) await service.travel?.(ms)
  }

  return {
    proxy,
    webhooks,
    fixtures: {
      ...Object.fromEntries(services.flatMap((s) => Object.entries(s.fixtures ?? {}))),
      proxy,
      settle,
    },
    travel,
    state: () =>
      Object.fromEntries(services.flatMap((s) => (s.state ? [[s.name, s.state()] as const] : []))),
    settle,
    async reset() {
      for (const service of services) await service.reset?.()
      await clearRun()
    },
    async snapshot() {
      for (const service of services) await service.snapshot?.()
    },
    async restore() {
      for (const service of services) {
        if (service.restore) await service.restore()
        else await service.reset?.()
      }

      await clearRun()
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

/**
 * `snapshot` and `restore` for a service backed by one emulator: the emulator's store is kept in
 * memory and put back, and webhook deliveries and anything else scheduled on its clock are dropped.
 */
export function keptEmulator(
  emulator: Emulator,
  clock?: ManualClock,
): Required<Pick<Service, "snapshot" | "restore">> {
  let kept: StoreSnapshot | undefined

  return {
    async snapshot() {
      kept = emulator.snapshot()
    },
    async restore() {
      if (kept === undefined) throw new Error("restore() before snapshot()")

      emulator.webhooks?.reset()
      clock?.restart(new Date())
      emulator.restore(kept)
    },
  }
}

/**
 * How far ahead `settle` plays an emulator's clock: far enough for every provider's webhook
 * retries, short of business events such as renewals, which only time travel reaches.
 */
const SETTLE_HORIZON_MS = 24 * 60 * 60 * 1000

/** Plays pending webhook deliveries and retries of `emulator` on `clock`, up to a day ahead. */
export async function settleWebhooks(emulator: Emulator, clock: ManualClock): Promise<void> {
  let left = SETTLE_HORIZON_MS

  for (let i = 0; i < 100; i++) {
    await emulator.webhooks?.idle()

    const next = clock.nextIn()

    if (next === undefined || next > left) return

    clock.advance(next)
    left -= next
  }

  throw new Error("webhook deliveries did not settle")
}

/** Most pieces of due work one travel runs, so a bad loop cannot hang the run. */
const MAX_TRAVEL_STEPS = 10_000

/**
 * Moves `clock` forward by `ms` one due callback at a time, letting `emulator`'s deliveries land
 * after each, so a renewal's webhook reaches the app before the next renewal falls due.
 */
export async function travelEmulator(
  emulator: Emulator,
  clock: ManualClock,
  ms: number,
): Promise<void> {
  let left = ms

  for (let step = 0; step < MAX_TRAVEL_STEPS; step++) {
    await emulator.webhooks?.idle()

    const next = clock.nextIn()

    if (next === undefined || next > left) break

    clock.advance(next)
    left -= next
  }

  clock.advance(left)
  await emulator.webhooks?.idle()
}
