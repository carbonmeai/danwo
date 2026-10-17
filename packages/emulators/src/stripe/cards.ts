import type { CardDetails, PaymentMethod } from "./entities.ts"
import { cardDetails, paymentMethodObject } from "./formatters.ts"
import { newId, unix } from "./helpers.ts"
import type { StripeStore } from "./store.ts"

const EXPIRY = { expMonth: 12, expYear: 2034 }

/** Stripe's test payment method tokens and the cards they stand for. */
const TEST_CARDS: Readonly<Record<string, CardDetails>> = {
  pm_card_visa: cardDetails({
    brand: "visa",
    last4: "4242",
    funding: "credit",
    country: "US",
    ...EXPIRY,
  }),
  pm_card_visa_debit: cardDetails({
    brand: "visa",
    last4: "5556",
    funding: "debit",
    country: "US",
    ...EXPIRY,
  }),
  pm_card_mastercard: cardDetails({
    brand: "mastercard",
    last4: "4444",
    funding: "credit",
    country: "US",
    ...EXPIRY,
  }),
  pm_card_amex: cardDetails({
    brand: "amex",
    last4: "8431",
    funding: "credit",
    country: "US",
    ...EXPIRY,
  }),
}

/** The card a Checkout payment uses: Stripe's Visa test card. */
export const CHECKOUT_TEST_CARD = "pm_card_visa"

/** A new card payment method, unattached unless `customer` is given. */
export function addCard(
  objects: StripeStore,
  card: CardDetails,
  now: Date,
  customer: string | null = null,
): PaymentMethod {
  return objects.paymentMethods.add(
    paymentMethodObject({ id: newId("pm"), created: unix(now), customer, card, metadata: {} }),
    null,
  )
}

/**
 * The payment method a reference names. A test token such as `pm_card_visa` makes a new payment
 * method each time, as Stripe does; a `pm_` id must exist.
 */
export function paymentMethodFor(
  objects: StripeStore,
  reference: string,
  now: Date,
): PaymentMethod | undefined {
  const card = TEST_CARDS[reference]

  return card ? addCard(objects, card, now) : objects.paymentMethods.get(reference)
}

/** The card a test token stands for, for `POST /v1/payment_methods` with `card[token]`. */
export function testCard(token: string): CardDetails | undefined {
  return TEST_CARDS[`pm_card_${token.replace(/^tok_/, "")}`]
}

/** The default test card, for a payment method created without card details. */
export function defaultCard(): CardDetails {
  return TEST_CARDS.pm_card_visa as CardDetails
}
