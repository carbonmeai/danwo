import type { Resolve } from "./expand.ts"
import type { StripeStore } from "./store.ts"

type Lookup = (id: string) => object | undefined

/** How to find an object of each kind, by the prefix of its id. */
function lookups(objects: StripeStore): Record<string, Lookup> {
  return {
    cus: (id) => objects.customers.get(id),
    prod: (id) => objects.products.get(id),
    price: (id) => objects.prices.get(id),
    pi: (id) => objects.paymentIntents.get(id),
    ch: (id) => objects.charges.get(id),
    pm: (id) => objects.paymentMethods.get(id),
    cs: (id) => objects.checkoutSessions.get(id),
    in: (id) => objects.invoices.get(id),
    pmc: (id) => objects.paymentMethodConfigurations.get(id),
  }
}

/** Finds any object the emulator holds by its id, from the id's prefix. */
export function stripeResolver(objects: StripeStore): Resolve {
  const byPrefix = lookups(objects)

  return (id) => byPrefix[id.slice(0, id.indexOf("_"))]?.(id)
}
