import type { Emulator, ManualClock, StoreSnapshot, WebhookDispatcher } from "@danwo/emulators"
import { clearWebhookFaults } from "@danwo/matrix"
import { type Proxy, type Route, startProxy } from "@danwo/proxy"

import type { MailSource } from "../mail/index.ts"

/**
 * One faked third party behind the worker's proxy: the hosts it answers (an emulator in-process
 * or an outside endpoint such as MiniStack), the fixtures it gives tests, and how it settles and
 * resets. `startServices` puts any mix of them behind one proxy.
 */
export interface Service {
  /** Names the service in fixtures' evidence and in `danwo matrix` labels (`stripe`, `s3`). */
  readonly name: string
  readonly routes: readonly Route[]
  /** Starts what the routes need before the proxy reads them, such as a local WebSocket server. */
  start?(): Promise<void>
  readonly fixtures?: Readonly<Record<string, unknown>>
  /** Webhook delivery `danwo matrix` can fault. */
  readonly webhooks?: WebhookDispatcher | undefined
  /** Hears of the proxy once it runs, for a service that reads the calls made through it. */
  attach?(proxy: Proxy): void
  /** Where mail this service sends lands (Clerk's codes, Resend's emails), for the `mail` fixture. */
  readonly mail?: readonly MailSource[]
  /** What the flight recorder keeps of this service when a run ends (an emulator's snapshot). */
  state?(): unknown
  settle?(): Promise<void>
  /**
   * Moves the service's time forward by `ms`, running what falls due on the way in order
   * (renewals, retries, expiries) and letting each step's deliveries land before the next.
   */
  travel?(ms: number): Promise<void>
  reset?(): Promise<void>
  /**
   * Keeps the state it is in now (just reset), for `restore` to return to; with `snapshotSlots`,
   * as `slot`, beside the states kept under other slots.
   */
  snapshot?(slot?: string): Promise<void>
  /** Back to the kept state, faster than a reset; services without one are reset instead. */
  restore?(slot?: string): Promise<void>
  /** Whether `snapshot` and `restore` keep a state per slot (see the environment's `snapshotSlots`). */
  readonly snapshotSlots?: boolean
  close(): Promise<void>
}

/** What happens to calls for hosts no service answers. */
export interface UnroutedHosts {
  /**
   * `passthrough` (default) sends them to the real host; `block` answers 502. This machine
   * (`localhost`, `127.0.0.1`), where the apps run, always passes, and so does the `allow` list.
   */
  readonly unmatched?: "passthrough" | "block"
  /** Hosts answered as blocked even when others pass through, e.g. `ANDROID_BACKGROUND_HOSTS`. */
  readonly blocked?: readonly string[]
  /** Hosts that always pass through, even under `unmatched: "block"`. */
  readonly allow?: readonly string[]
  /** Analytics and telemetry hosts: blocked by default; `passthrough` lets them go. */
  readonly telemetry?: "block" | "passthrough"
}

/** Just the `UnroutedHosts` options from a larger options object. */
export function unroutedOf(options: UnroutedHosts): UnroutedHosts {
  return {
    ...(options.unmatched && { unmatched: options.unmatched }),
    ...(options.blocked && { blocked: options.blocked }),
    ...(options.allow && { allow: options.allow }),
    ...(options.telemetry && { telemetry: options.telemetry }),
  }
}

/** Services started together; its fields slot straight into a `WorkerEnvironment`. */
export interface Services {
  readonly proxy: Proxy
  /** Every webhook-delivering service's dispatcher, by service name; undefined when none deliver. */
  readonly webhooks: Readonly<Record<string, WebhookDispatcher>> | undefined
  /** Every service's fixtures, plus `proxy` and `settle`. */
  readonly fixtures: Readonly<Record<string, unknown>>
  /** Every service's mail sources, so the `mail` fixture and the agent read what they send. */
  readonly mail?: readonly MailSource[]
  /** Every service's `state()`, by service name. */
  state(): Readonly<Record<string, unknown>>
  /** Lets every service's background work finish. */
  settle(): Promise<void>
  /** Moves the apps' clocks (through the proxy) and every service's time forward by `ms`. */
  travel(ms: number): Promise<void>
  /** Every service back to its seed; proxy log, fault rules and the apps' clock offset cleared. */
  reset(): Promise<void>
  /** Keeps every service's state now, for `restore`, under `slot` when they keep slots. */
  snapshot(slot?: string): Promise<void>
  /** Every service back to its kept state (or its seed, when it keeps none); log and faults cleared. */
  restore(slot?: string): Promise<void>
  /** Whether every service that keeps a state keeps one per slot. */
  readonly snapshotSlots: boolean
  close(): Promise<void>
}

/**
 * Starts one proxy in front of `services`, e.g. a Stripe emulator, an S3 emulator and MiniStack
 * for the rest of AWS. Other hosts pass through unless `unmatched` is `block`.
 */
export async function startServices(
  services: readonly Service[],
  options: UnroutedHosts = {},
): Promise<Services> {
  for (const service of services) await service.start?.()

  const proxy = await startProxy({ routes: services.flatMap((s) => s.routes), ...options })

  for (const service of services) service.attach?.(proxy)
  const webhooks = webhooksByService(services)
  const mail = services.flatMap((s) => s.mail ?? [])

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
    ...(mail.length > 0 && { mail }),
    travel,
    state: () =>
      Object.fromEntries(services.flatMap((s) => (s.state ? [[s.name, s.state()] as const] : []))),
    settle,
    async reset() {
      for (const service of services) await service.reset?.()
      await clearRun()
    },
    async snapshot(slot?: string) {
      for (const service of services) await service.snapshot?.(slot)
    },
    async restore(slot?: string) {
      for (const service of services) {
        if (service.restore) await service.restore(slot)
        else await service.reset?.()
      }

      await clearRun()
    },
    snapshotSlots: services.every((s) => s.snapshot === undefined || s.snapshotSlots === true),
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

/** The slot a `snapshot()` or `restore()` called without one keeps. */
const DEFAULT_SLOT = "default"

/**
 * `snapshot` and `restore` for a service backed by one emulator: the emulator's store is kept in
 * memory, one copy per slot, and put back; webhook deliveries and anything else scheduled on its
 * clock are dropped.
 */
export function keptEmulator(
  emulator: Emulator,
  clock?: ManualClock,
): Required<Pick<Service, "snapshot" | "restore" | "snapshotSlots">> {
  const kept = new Map<string, StoreSnapshot>()

  return {
    async snapshot(slot = DEFAULT_SLOT) {
      kept.set(slot, emulator.snapshot())
    },
    async restore(slot = DEFAULT_SLOT) {
      const state = kept.get(slot)

      if (state === undefined) throw new Error(`restore("${slot}") before snapshot("${slot}")`)

      emulator.webhooks?.reset()
      clock?.restart(new Date())
      emulator.restore(state)
    },
    snapshotSlots: true,
  }
}

/**
 * What a service backed by one emulator on a manual clock does besides answering its hosts: its
 * state for the flight recorder, settling, time travel, reset (`reseed` applies its seed again),
 * snapshot and restore, close.
 */
export function emulatorLifecycle(emulator: Emulator, clock: ManualClock, reseed: () => void) {
  return {
    state: () => emulator.snapshot(),
    settle: () => settleWebhooks(emulator, clock),
    travel: (ms: number) => travelEmulator(emulator, clock, ms),
    async reset() {
      emulator.reset()
      clock.restart(new Date())
      reseed()
    },
    ...keptEmulator(emulator, clock),
    close: () => emulator.close(),
  }
}

/** The lifecycle a single-service environment hands on from its started `services`. */
export function servicesLifecycle(services: Services) {
  return {
    /* Where the services' mail lands (Clerk's codes, Resend's emails), for the `mail` fixture. */
    ...(services.mail && { mail: services.mail }),
    settle: () => services.settle(),
    travel: (ms: number) => services.travel(ms),
    reset: () => services.reset(),
    snapshot: (slot?: string) => services.snapshot(slot),
    restore: (slot?: string) => services.restore(slot),
    snapshotSlots: services.snapshotSlots,
    close: () => services.close(),
  }
}

/**
 * How far ahead `settle` plays an emulator's clock: far enough for every provider's webhook
 * retries, short of business events such as renewals, which only time travel reaches.
 */
const SETTLE_HORIZON_MS = 24 * 60 * 60 * 1000

/** Plays pending webhook deliveries and retries of `emulator` on `clock`, up to a day ahead. */
async function settleWebhooks(emulator: Emulator, clock: ManualClock): Promise<void> {
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
async function travelEmulator(emulator: Emulator, clock: ManualClock, ms: number): Promise<void> {
  let left = ms

  /* The apps' clocks jump at once, so what is signed on the way carries their new time. */
  clock.travelled(ms)

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
