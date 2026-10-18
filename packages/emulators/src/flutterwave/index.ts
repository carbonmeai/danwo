import { defineEmulator, type EmulatorContext } from "../define.ts"
import { HttpError } from "../errors.ts"
import { flutterwaveKey } from "./auth.ts"
import type { FlutterwaveRouteContext } from "./context.ts"
import { FlutterwaveEvents, webhookEndpoints } from "./events.ts"
import { failure, serverError } from "./helpers.ts"
import { renewDue } from "./payments.ts"
import { paymentRoutes } from "./routes/payments.ts"
import { planRoutes } from "./routes/plans.ts"
import { transactionRoutes } from "./routes/transactions.ts"
import { transferRoutes } from "./routes/transfers.ts"
import { virtualAccountRoutes } from "./routes/virtual-accounts.ts"
import { seedFlutterwave } from "./seed.ts"
import { FLUTTERWAVE_DELIVERY, flutterwaveSigner } from "./signature.ts"
import { flutterwaveStore } from "./store.ts"

export { flutterwaveOutboundFaults } from "./faults.ts"
export { FLUTTERWAVE_HOSTS } from "./helpers.ts"
export {
  type FlutterwaveBank,
  flutterwaveBank,
  type FlutterwaveLedger,
  flutterwaveLedger,
} from "./ledger.ts"
export {
  type FlutterwaveSeedAccount,
  type FlutterwaveSeedConfig,
  type FlutterwaveSeedPlan,
  seedFlutterwave,
} from "./seed.ts"
export { flutterwaveSignature } from "./signature.ts"

function routeContext(emulator: EmulatorContext): FlutterwaveRouteContext {
  return { ...emulator, flutterwave: flutterwaveStore(emulator.store) }
}

/**
 * Flutterwave's v3 API (`api.flutterwave.com`) in test mode, with its hosted checkout
 * (`checkout.flutterwave.com`): Standard payment links paid with Flutterwave's test cards, bank
 * transfer or mobile money; transaction verification, refunds and fees; payment plans and their
 * subscriptions; transfers settling as their test-mode references say, beneficiaries, banks,
 * account lookups and balances; and virtual accounts. Webhooks carry the dashboard's secret hash in
 * `verif-hash` and an HMAC of the body in `flutterwave-signature`.
 */
export const flutterwave = defineEmulator({
  name: "flutterwave",
  setup(emulator) {
    const context = routeContext(emulator)
    const events = new FlutterwaveEvents(context)

    emulator.app.onError((error, c) =>
      error instanceof HttpError ? failure(c, error.status, error.message) : serverError(c),
    )
    emulator.app.use(flutterwaveKey())
    emulator.app.use(async (_c, next) => {
      renewDue(context, events)

      return next()
    })
    paymentRoutes(context, events)
    transactionRoutes(context, events)
    planRoutes(context, events)
    transferRoutes(context, events)
    virtualAccountRoutes(context)
  },
  seed: ({ store }) => seedFlutterwave(store),
  webhooks: (emulator) => ({
    endpoints: () => webhookEndpoints(routeContext(emulator)),
    sign: flutterwaveSigner,
    policy: FLUTTERWAVE_DELIVERY,
  }),
})
