import { randomUUID } from "node:crypto"

import { defineEmulator, type EmulatorContext } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Context, ErrorHandler, Middleware } from "../http.ts"
import { bachsApiKey } from "./auth.ts"
import type { BachsContext } from "./context.ts"
import { runDue } from "./due.ts"
import { BachsEvents, deliveryEndpoints } from "./events.ts"
import { BachsFailure, errorBody } from "./helpers.ts"
import { bachsIdempotency } from "./idempotency.ts"
import { accountRoutes } from "./routes/account.ts"
import { checkoutSessionRoutes } from "./routes/checkout-sessions.ts"
import { customerRoutes } from "./routes/customers.ts"
import { hostedRoutes } from "./routes/hosted.ts"
import { paymentRoutes } from "./routes/payments.ts"
import { payoutRoutes } from "./routes/payouts.ts"
import { productRoutes } from "./routes/products.ts"
import { refundRoutes } from "./routes/refunds.ts"
import { subscriptionRoutes } from "./routes/subscriptions.ts"
import { BACHS_DELIVERY, bachsSigner } from "./signature.ts"
import { bachsStore } from "./store.ts"

export { bachsOutboundFaults } from "./faults.ts"
export { BACHS_HOSTS } from "./helpers.ts"
export { type BachsDeposit, type BachsLedger, bachsLedger } from "./ledger.ts"
export {
  type BachsSeedConfig,
  type BachsSeedCustomer,
  type BachsSeedDestination,
  type BachsSeedEndpoint,
  type BachsSeedProduct,
  seedBachs,
} from "./seed.ts"
export { bachsSignature } from "./signature.ts"

/** The general error code for a status a handler answered without one of its own. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "TOO_MANY_REQUESTS",
}

/** Answers errors in Bachs's flat error object, with its stable `error_code`. */
const bachsErrors: ErrorHandler = (error, c) => {
  if (error instanceof BachsFailure)
    return c.json(errorBody(error.code, error.message, error.problems), error.status)

  const status = error instanceof HttpError ? error.status : 500
  const code = CODE_BY_STATUS[status] ?? "INTERNAL_SERVER_ERROR"

  return c.json(
    errorBody(code, error instanceof Error ? error.message : "Internal server error"),
    status,
  )
}

/** Every answer carries a request id and the sandbox's rate-limit headers. */
function responseHeaders(c: Context): void {
  c.header("x-request-id", randomUUID())
  c.header("X-RateLimit-Limit", "100")
  c.header("X-RateLimit-Remaining", "99")
  c.header("X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + 60))
}

/** Runs the work due by now (settlements, renewals, expiries) before answering anything. */
function catchUp(context: BachsContext): Middleware {
  return async (c, next) => {
    runDue(context)
    responseHeaders(c)

    return next()
  }
}

function contextOf(emulator: EmulatorContext): BachsContext {
  const bachs = bachsStore(emulator.store)
  const events = new BachsEvents(bachs, emulator.outbox, emulator.clock)
  const context: BachsContext = {
    app: emulator.app,
    bachs,
    events,
    clock: emulator.clock,
    timer: emulator.timer,
    /**
     * A timer can fire before the clock reads its due time (Node measures a timeout from the loop's
     * cached time, which runs behind under load), and work not yet due would then wait for the next
     * request: it waits again for what is left instead.
     */
    wakeAt: (at) => {
      const left = () => at.getTime() - emulator.clock().getTime()

      const wake = () => {
        if (left() > 0) emulator.timer.setTimeout(wake, left())
        else runDue(context)
      }

      emulator.timer.setTimeout(wake, Math.max(0, left()))
    },
  }

  return context
}

/**
 * Bachs: payments and billing on its real hosts. The API (`api.bachs.io`, `sandbox-api.bachs.io`)
 * covers products, customers, checkout sessions, payments, refunds, subscriptions with trials,
 * proration and payment recovery, portal sessions, payout destinations, quotes and payouts,
 * balances, virtual accounts and webhook endpoints. `checkout.bachs.io` serves the hosted checkout
 * (and `bachs.js` for the overlay) and the card-update page recovery emails link to;
 * `portal.bachs.io` serves the customer portal. Payments settle, subscriptions renew and payouts
 * complete on the emulator's clock; every webhook is signed with `X-Bachs-Signature` and
 * `X-Bachs-Signature-V2`.
 */
export const bachs = defineEmulator({
  name: "bachs",
  setup(emulator) {
    const context = contextOf(emulator)
    const { app } = emulator

    app.onError(bachsErrors)
    app.use(catchUp(context))
    app.use(bachsApiKey())
    app.use(bachsIdempotency(emulator.store, emulator.clock))
    for (const register of [
      productRoutes,
      customerRoutes,
      checkoutSessionRoutes,
      paymentRoutes,
      refundRoutes,
      subscriptionRoutes,
      payoutRoutes,
      accountRoutes,
      hostedRoutes,
    ])
      register(context)
  },
  webhooks: ({ store, clock, wallClock }) => ({
    endpoints: () => deliveryEndpoints(bachsStore(store)),
    sign: bachsSigner(clock, wallClock),
    policy: BACHS_DELIVERY,
  }),
})
