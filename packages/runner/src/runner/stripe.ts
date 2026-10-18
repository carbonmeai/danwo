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
  keptEmulator,
  type Service,
  settleWebhooks,
  travelEmulator,
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
  readonly settle: () => Promise<void>
  /** Moves the app's clock and the emulator's time forward by `ms`; see `time.travel`. */
  travel(ms: number): Promise<void>
  /** Emulator back to its seed, proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Keeps the emulator's state now (right after a reset), for `restore`. */
  snapshot(): Promise<void>
  /** Emulator back to the kept state, faster than a reset; proxy log and fault rules cleared. */
  restore(): Promise<void>
  /** Fixtures for tests: `stripe` (the emulator), `proxy`, `settle`. */
  readonly fixtures: {
    readonly stripe: Emulator
    readonly proxy: Proxy
    readonly settle: () => Promise<void>
  }
  close(): Promise<void>
}

/**
 * A Stripe emulator for `startServices`: answers `api.stripe.com` and `checkout.stripe.com`,
 * delivers webhooks on a manual clock, and gives tests the `stripe` fixture.
 */
export function stripeService(options: StripeOptions = {}): StripeService {
  const clock = new ManualClock(new Date())
  const emulator = createEmulator(stripe, {
    clock: clock.clock,
    timer: clock.timer,
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
    routes: [{ hosts: ["api.stripe.com", "checkout.stripe.com"], handler: emulator.fetch }],
    fixtures: { stripe: emulator },
    webhooks: emulator.webhooks,
    state: () => emulator.snapshot(),
    settle: () => settleWebhooks(emulator, clock),
    travel: (ms) => travelEmulator(emulator, clock, ms),
    async reset() {
      emulator.reset()
      clock.restart(new Date())
      seed()
    },
    ...keptEmulator(emulator, clock),
    close: () => emulator.close(),
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
  const settle = () => services.settle()

  return {
    emulator: service.emulator,
    proxy,
    clock: service.clock,
    settle,
    travel: (ms: number) => services.travel(ms),
    reset: () => services.reset(),
    snapshot: () => services.snapshot(),
    restore: () => services.restore(),
    fixtures: { stripe: service.emulator, proxy, settle },
    close: () => services.close(),
  }
}
