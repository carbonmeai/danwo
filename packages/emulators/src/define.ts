import { App } from "./http.ts"
import { Outbox } from "./outbox.ts"
import { type Clock, Store, type StoreSnapshot, systemClock } from "./store.ts"
import { systemTimer, type Timer } from "./time.ts"
import {
  type DeliveryPolicy,
  WebhookDispatcher,
  type WebhookAnswerHandler,
  type WebhookEndpoint,
  type WebhookPayload,
  type WebhookSigner,
} from "./webhooks.ts"

/** What an emulator's setup gets to build its routes and state on. */
export interface EmulatorContext {
  readonly app: App
  readonly store: Store
  readonly outbox: Outbox
  /** The emulator's own origin, used in URLs it hands out (checkout pages, sign-in pages). */
  readonly baseUrl: string
  readonly clock: Clock
  /** Schedules work for later on the emulator's time, such as a message's status changes. */
  readonly timer: Timer
  /**
   * Real time as the apps see it: the system clock, plus any time travel that moved their clocks.
   * For stamps apps compare with their own clock, such as webhook signature timestamps.
   */
  readonly wallClock: Clock
}

/** How an emulator's webhooks are addressed, signed and retried. */
export interface WebhookSetup {
  readonly endpoints: () => readonly WebhookEndpoint[]
  readonly sign: WebhookSigner
  readonly policy: DeliveryPolicy
  readonly payload?: WebhookPayload
  /** Reads what an endpoint answered to a delivered webhook, for providers that act on the answer. */
  readonly onAnswer?: WebhookAnswerHandler
}

/** A provider emulator: routes and state set up per instance, optional seed data and webhooks. */
export interface EmulatorDefinition {
  readonly name: string
  readonly setup: (context: EmulatorContext) => void
  /** Default data, applied when the emulator starts and after every reset. */
  readonly seed?: (context: EmulatorContext) => void
  readonly webhooks?: (context: EmulatorContext) => WebhookSetup
}

/** Checks a definition's name and returns it, typed. */
export function defineEmulator(definition: EmulatorDefinition): EmulatorDefinition {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.name))
    throw new Error(
      `emulator name "${definition.name}" must be lower-case letters, digits and dashes`,
    )

  return definition
}

export interface EmulatorOptions {
  readonly baseUrl?: string
  readonly clock?: Clock
  /** Schedules webhook retries; a manual timer makes them deterministic. */
  readonly timer?: Timer
  /** Real time as the apps see it (see `EmulatorContext.wallClock`); the system clock by default. */
  readonly wallClock?: Clock
  readonly deliveryPolicy?: DeliveryPolicy
  /** Used to deliver webhooks; defaults to the global fetch. */
  readonly fetch?: typeof fetch
}

/** A running emulator instance. */
export interface Emulator {
  readonly name: string
  readonly baseUrl: string
  readonly store: Store
  readonly outbox: Outbox
  readonly webhooks: WebhookDispatcher | undefined
  readonly fetch: (request: Request) => Promise<Response>
  snapshot(): StoreSnapshot
  restore(snapshot: StoreSnapshot): void
  /** Clears all state and pending webhooks, then applies the seed again. */
  reset(): void
  close(): Promise<void>
}

/** Starts an instance of `definition`, in-process. */
export function createEmulator(
  definition: EmulatorDefinition,
  options: EmulatorOptions = {},
): Emulator {
  const clock = options.clock ?? systemClock
  const baseUrl = (options.baseUrl ?? `http://${definition.name}.localhost`).replace(/\/+$/, "")
  const context: EmulatorContext = {
    app: new App(),
    store: new Store(clock),
    outbox: new Outbox(clock),
    baseUrl,
    clock,
    timer: options.timer ?? systemTimer,
    wallClock: options.wallClock ?? systemClock,
  }

  definition.setup(context)
  definition.seed?.(context)

  const webhooks =
    definition.webhooks && dispatcherFor(definition.webhooks(context), context, options)

  webhooks?.start()

  return {
    name: definition.name,
    baseUrl,
    store: context.store,
    outbox: context.outbox,
    webhooks,
    fetch: (request) => context.app.fetch(request),
    snapshot: () => context.store.snapshot(),
    restore: (snapshot) => context.store.restore(snapshot),
    reset() {
      context.store.reset()
      context.outbox.clear()
      webhooks?.reset()
      definition.seed?.(context)
    },
    close: async () => {
      await webhooks?.stop()
    },
  }
}

function dispatcherFor(
  setup: WebhookSetup,
  context: EmulatorContext,
  options: EmulatorOptions,
): WebhookDispatcher {
  return new WebhookDispatcher({
    outbox: context.outbox,
    endpoints: setup.endpoints,
    sign: setup.sign,
    ...(setup.payload && { payload: setup.payload }),
    ...(setup.onAnswer && { onAnswer: setup.onAnswer }),
    policy: options.deliveryPolicy ?? setup.policy,
    clock: context.clock,
    timer: context.timer,
    ...(options.fetch && { fetch: options.fetch }),
  })
}
