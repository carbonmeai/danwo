import {
  createEmulator,
  type Emulator,
  ManualClock,
  seedStripe,
  stripe,
  type StripeSeedConfig,
} from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"

import {
  emulatorLifecycle,
  type Service,
  servicesLifecycle,
  settleFixture,
  startServices,
} from "./services.ts"

/** Options of `stripeService()` and `stripeEnvironment()`. */
export interface StripeOptions {
  /** Runs on start and after every reset; a function, so it can use values only known later (the app's webhook URL). */
  readonly seed?: () => StripeSeedConfig | undefined
}

export interface StripeService extends Service {
  readonly emulator: Emulator
  readonly clock: ManualClock
}

/** What `stripeEnvironment()` starts: the Stripe emulator behind its own proxy, on a manual clock. */
export interface StripeEnvironment {
  readonly emulator: Emulator
  readonly proxy: Proxy
  readonly clock: ManualClock
  /** Plays every pending webhook delivery and retry to the end on the manual clock. */
  readonly settle: () => Promise<readonly string[]>
  /** Moves the app's clock and the emulator's time forward by `ms`; see `time.travel`. */
  readonly travel: (ms: number) => Promise<void>
  /** Emulator back to its seed, proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Keeps the emulator's state now (right after a reset), for `restore`. */
  snapshot(slot?: string): Promise<void>
  /** Emulator back to the kept state, faster than a reset; proxy log and fault rules cleared. */
  restore(slot?: string): Promise<void>
  /** Whether `snapshot` and `restore` keep a state per slot. */
  readonly snapshotSlots: boolean
  /** Fixtures for tests: `stripe` (the emulator), `proxy`, `settle`. */
  readonly fixtures: {
    readonly stripe: Emulator
    readonly proxy: Proxy
    readonly settle: () => Promise<void>
  }
  close(): Promise<void>
}

/**
 * A Stripe emulator for `startServices`: answers `api.stripe.com`, `checkout.stripe.com` and `js.stripe.com`,
 * delivers webhooks on a manual clock, and gives tests the `stripe` fixture.
 */
export function stripeService(options: StripeOptions = {}): StripeService {
  const clock = new ManualClock(new Date())
  const emulator = createEmulator(stripe, {
    clock: clock.clock,
    timer: clock.timer,
    wallClock: clock.wall,
    baseUrl: "https://checkout.stripe.com",
  })

  const seed = () => {
    const config = options.seed?.()

    if (config) {
      seedStripe(emulator.store, config)
    }
  }

  seed()

  return {
    name: "stripe",
    emulator,
    clock,
    routes: [
      {
        hosts: ["api.stripe.com", "checkout.stripe.com", "js.stripe.com"],
        handler: emulator.fetch,
      },
    ],
    fixtures: { stripe: emulator },
    webhooks: emulator.webhooks,
    ...emulatorLifecycle(emulator, clock, seed),
  }
}

/**
 * A worker-scoped Stripe emulator behind its own danwo proxy: `api.stripe.com` and
 * `checkout.stripe.com` route to it, other hosts pass through. To combine it with other services
 * behind one proxy, use `stripeService` with `startServices`.
 */
export async function stripeEnvironment(
  options: StripeOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<StripeEnvironment> {
  const service = stripeService(options)
  const services = await startServices([service], options)
  const { proxy } = services
  const lifecycle = servicesLifecycle(services)

  return {
    emulator: service.emulator,
    proxy,
    clock: service.clock,
    ...lifecycle,
    fixtures: { stripe: service.emulator, proxy, settle: settleFixture(lifecycle.settle) },
  }
}
