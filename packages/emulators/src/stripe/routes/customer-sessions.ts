import type { StripeRouteContext } from "../context.ts"
import { asRecord, badParam, newId, noSuch, readParams, unix } from "../helpers.ts"

const THIRTY_MINUTES = 30 * 60

/** Which embedded components a session enables: `components[pricing_table][enabled]=true` and so on. */
function componentsOf(value: unknown): Record<string, { enabled: boolean }> {
  const components = asRecord(value) ?? {}

  return Object.fromEntries(
    Object.entries(components).map(([name, settings]) => [
      name,
      { ...asRecord(settings), enabled: asRecord(settings)?.enabled === "true" },
    ]),
  )
}

/** Customer Sessions: a short-lived client secret for Stripe's embedded components. */
export function customerSessionRoutes({ app, objects, clock }: StripeRouteContext): void {
  app.post("/v1/customer_sessions", async (c) => {
    const params = await readParams(c)
    const customer = typeof params.customer === "string" ? params.customer : undefined

    if (!customer) return badParam(c, "customer")
    if (!objects.customers.get(customer)) return noSuch(c, "customer", customer, "customer")

    const created = unix(clock())

    return c.json({
      object: "customer_session",
      client_secret: `cuss_secret_${newId("x", 40).slice(2)}`,
      components: componentsOf(params.components),
      created,
      customer,
      customer_account: null,
      expires_at: created + THIRTY_MINUTES,
      livemode: false,
    })
  })
}
