import { defineEmulator, type EmulatorContext } from "../define.ts"
import { providerErrors } from "../errors.ts"
import { paystackAuth } from "./auth.ts"
import type { PaystackRouteContext } from "./context.ts"
import { fail } from "./helpers.ts"
import { PaystackPayments } from "./payments.ts"
import { bankRoutes } from "./routes/banks.ts"
import { checkoutRoutes } from "./routes/checkout.ts"
import { customerRoutes } from "./routes/customers.ts"
import { planRoutes } from "./routes/plans.ts"
import { refundRoutes } from "./routes/refunds.ts"
import { transactionRoutes } from "./routes/transactions.ts"
import { transferRoutes } from "./routes/transfers.ts"
import { seedBanks } from "./seed.ts"
import { PAYSTACK_DELIVERY, paystackSigner, webhookEndpoints } from "./signature.ts"
import { paystackStore } from "./store.ts"

export { paystackOutboundFaults } from "./faults.ts"
export { PAYSTACK_HOSTS } from "./helpers.ts"
export { type PaystackBank, paystackBank, type PaystackLedger, paystackLedger } from "./inspect.ts"
export {
  type PaystackSeedAccount,
  type PaystackSeedConfig,
  type PaystackSeedCustomer,
  type PaystackSeedIntegration,
  type PaystackSeedPlan,
  seedPaystack,
} from "./seed.ts"
export { paystackSignature } from "./signature.ts"
export { TRANSFER_OTP as PAYSTACK_TRANSFER_OTP } from "./routes/transfers.ts"

/**
 * Paystack on its real hostnames: transactions initialized by the API (`api.paystack.co`) and paid
 * on the hosted page (`checkout.paystack.com`) with Paystack's test cards, by bank transfer or
 * USSD; verify and charge saved authorizations; customers; plans with subscriptions renewed on
 * the emulator's clock; transfers out of the balance and refunds that settle later; banks, account
 * resolution and dedicated accounts. Events go to the integration's webhook URL signed with
 * `x-paystack-signature`.
 */
export const paystack = defineEmulator({
  name: "paystack",
  setup(emulator) {
    const context = routeContext(emulator)
    const payments = new PaystackPayments(context)

    emulator.app.onError(providerErrors((c, status, message) => fail(c, status, message)))
    emulator.app.use(paystackAuth(context.paystack))
    transactionRoutes(context, payments)
    customerRoutes(context, payments)
    planRoutes(context, payments)
    transferRoutes(context)
    refundRoutes(context)
    bankRoutes(context)
    // The hosted page's paths are a bare access code, so they go last.
    checkoutRoutes(context, payments)
  },
  seed: (emulator) => seedBanks(emulator.store),
  webhooks: (emulator) => {
    const context = routeContext(emulator)

    return {
      endpoints: () => webhookEndpoints(context.paystack),
      sign: paystackSigner,
      policy: PAYSTACK_DELIVERY,
    }
  },
})

function routeContext(emulator: EmulatorContext): PaystackRouteContext {
  return { ...emulator, paystack: paystackStore(emulator.store) }
}
