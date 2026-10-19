import type { Include, Resolve } from "./expand.ts"
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
    sub: (id) => objects.subscriptions.get(id),
    seti: (id) => objects.setupIntents.get(id),
  }
}

/** Finds any object the emulator holds by its id, from the id's prefix. */
export function stripeResolver(objects: StripeStore): Resolve {
  const byPrefix = lookups(objects)

  return (id) => byPrefix[id.slice(0, id.indexOf("_"))]?.(id)
}

/** An invoice's includable field when it was never collected: no payments, no secret. */
function nothingIncluded(key: "payments" | "confirmation_secret"): unknown {
  return key === "payments"
    ? { object: "list", data: [], has_more: false, url: "/v1/invoices/payments" }
    : null
}

/** What an invoice shows only when expanded: `payments` and `confirmation_secret`. */
export function stripeIncludes(objects: StripeStore): Include {
  return (target, key) => {
    if (target.object !== "invoice" || typeof target.id !== "string") return undefined
    if (key !== "payments" && key !== "confirmation_secret") return undefined

    return objects.invoiceIncludes.get(target.id)?.[key] ?? nothingIncluded(key)
  }
}
