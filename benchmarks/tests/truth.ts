/**
 * Ground truth the benchmark's tests judge against: the app's own state from `/__state`, and what
 * the emulators saw. Every style of test (locators, agent, mixed) uses the same invariants, so a
 * bug is caught or missed on equal terms.
 */
import {
  type DanwoFixtures,
  type Emulator,
  slackWorkspace,
  type StripeFixtures,
  test as base,
  z,
} from "@danwo/sdk"

/** The fixtures every benchmark test gets. */
export const test = base.extend<StripeFixtures & { readonly slack: Emulator }>()

const Order = z.object({
  id: z.string(),
  status: z.enum(["pending", "paid"]),
  paidBy: z.enum(["webhook", "redirect"]).nullable(),
  seats: z.number(),
})

const State = z.object({
  accounts: z.array(z.object({ email: z.string(), verified: z.boolean() })),
  settings: z.object({ name: z.string(), email: z.string(), age: z.number() }),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  uploads: z.array(z.object({ name: z.string(), bytes: z.number() })),
  subscribers: z.array(z.string()),
  approved: z.boolean(),
  notified: z.number(),
  orders: z.array(Order),
  credits: z.number(),
  errorsShown: z.array(z.string()),
})

export type BenchState = z.infer<typeof State>

/** Puts the app's own state back to how it starts, so scenarios never see each other's leftovers. */
export async function resetApp({ app }: Pick<DanwoFixtures, "app">): Promise<void> {
  await fetch(new URL("/__test/reset", app.baseUrl), { method: "POST" })
}

/** The app's state right now. */
export async function stateOf(baseUrl: string): Promise<BenchState> {
  const response = await fetch(new URL("/__state", baseUrl))

  return State.parse(await response.json())
}

const Sessions = z.object({
  data: z.array(
    z.object({ client_reference_id: z.string().nullable(), payment_status: z.string() }),
  ),
})

/** Every Checkout Session the Stripe emulator holds. */
async function sessionsOf(stripe: Emulator) {
  const response = await stripe.fetch(
    new Request("https://api.stripe.com/v1/checkout/sessions?limit=100", {
      headers: { authorization: "Bearer sk_test_bench" },
    }),
  )

  return Sessions.parse(await response.json()).data
}

/** The checks a payment flow must pass however the run went, whatever fault hit it. */
interface PaymentTruth {
  /** Orders the app marked paid without Stripe's signed event saying so. */
  readonly paidWithoutWebhook: number
  /** Credits the app granted, and what Stripe was paid for (1000 credits a two-seat order). */
  readonly credits: number
  readonly creditsPaidFor: number
  /** The most Checkout Sessions created for one order. */
  readonly sessionsPerOrder: number
  /** Errors the app showed that leaked a provider's raw answer. */
  readonly rawErrors: number
}

const RAW = /\b[45]\d\d\b|rate limit|stripe error/i

async function paymentTruth(baseUrl: string, stripe: Emulator): Promise<PaymentTruth> {
  const [state, sessions] = await Promise.all([stateOf(baseUrl), sessionsOf(stripe)])
  const perOrder = state.orders.map(
    (order) => sessions.filter((s) => s.client_reference_id === order.id).length,
  )
  const paid = sessions.filter((s) => s.payment_status === "paid").length

  return {
    paidWithoutWebhook: state.orders.filter((o) => o.status === "paid" && o.paidBy !== "webhook")
      .length,
    credits: state.credits,
    creditsPaidFor: 1000 * paid,
    sessionsPerOrder: Math.max(0, ...perOrder),
    rawErrors: state.errorsShown.filter((message) => RAW.test(message)).length,
  }
}

/** Whether the app's notification reached Slack's #general. */
function slackSent(slack: Emulator): boolean {
  return slackWorkspace(slack)
    .messages("general")
    .some((message) => message.text.includes("look at the dashboard"))
}

/** Fixtures the shared invariants read. */
type Judge = Pick<DanwoFixtures, "app" | "expect"> & { readonly stripe: Emulator }

/**
 * The payment invariant: an order is fulfilled only by Stripe's signed event, never more credits
 * than Stripe was paid for, at most one Checkout Session per order, and no raw provider error in
 * front of a customer.
 */
export async function paymentsHold({ app, stripe, expect }: Judge): Promise<void> {
  const truth = await paymentTruth(app.baseUrl, stripe)

  expect(truth.paidWithoutWebhook).toBe(0)
  expect(truth.credits).toBeLessThanOrEqual(truth.creditsPaidFor)
  expect(truth.sessionsPerOrder).toBeLessThanOrEqual(1)
  expect(truth.rawErrors).toBe(0)
}

/** Every account the app created was verified with its emailed code. */
export async function accountsVerified({ app, expect }: Pick<DanwoFixtures, "app" | "expect">) {
  expect((await stateOf(app.baseUrl)).accounts.every((account) => account.verified)).toBe(true)
}

/** The saved settings never hold an email without an @. */
export async function settingsValid({ app, expect }: Pick<DanwoFixtures, "app" | "expect">) {
  expect((await stateOf(app.baseUrl)).settings.email).toContain("@")
}

/** Deleting Borealis removed it and nothing else. */
export async function borealisDeleted({ app, expect }: Pick<DanwoFixtures, "app" | "expect">) {
  const names = (await stateOf(app.baseUrl)).projects.map((project) => project.name)

  expect(names).toEqual(["Atlas", "Cirrus"])
}

/** The team's notification reached Slack's #general. */
export function teamNotified({
  slack,
  expect,
}: Pick<DanwoFixtures, "expect"> & { readonly slack: Emulator }) {
  expect(slackSent(slack)).toBe(true)
}
