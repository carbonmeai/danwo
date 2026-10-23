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
  /** Declined everywhere: saving it fails, and so does any charge (`4000000000000002`). */
  pm_card_chargeDeclined: cardDetails({
    brand: "visa",
    last4: "0002",
    funding: "credit",
    country: "US",
    ...EXPIRY,
  }),
  /** Saves fine, but every charge to it is declined (`4000000000000341`): a failed renewal. */
  pm_card_chargeCustomerFail: cardDetails({
    brand: "visa",
    last4: "0341",
    funding: "credit",
    country: "US",
    ...EXPIRY,
  }),
  /** Asks for 3D Secure on every setup and charge (`4000002760003184`). */
  pm_card_authenticationRequired: cardDetails({
    brand: "visa",
    last4: "3184",
    funding: "credit",
    country: "US",
    ...EXPIRY,
  }),
}

/**
 * What a card does when it is saved or charged: approved, declined, declined only when charged
 * (it saves fine), or held for 3D Secure authentication.
 */
export type CardOutcome = "approved" | "declined" | "declined_on_charge" | "authenticate"

/** How Stripe's test cards behave, by their last four digits. */
const OUTCOMES: Readonly<Record<string, CardOutcome>> = {
  "0002": "declined",
  "0341": "declined_on_charge",
  "3184": "authenticate",
  "3155": "authenticate",
}

/** What saving (`setup`) or charging a payment method does, by its test card. */
export function cardOutcome(method: PaymentMethod, use: "setup" | "charge"): CardOutcome {
  const outcome = OUTCOMES[method.card?.last4 ?? ""] ?? "approved"

  if (outcome === "declined_on_charge") return use === "charge" ? "declined" : "approved"

  return outcome
}

/** The card a Checkout payment uses when the payer names none: Stripe's Visa test card. */
const CHECKOUT_TEST_CARD = "pm_card_visa"

/** Stripe's test card numbers the hosted Checkout page accepts, and the test card each stands for. */
const CHECKOUT_NUMBERS: Readonly<Record<string, string>> = {
  "4242424242424242": "pm_card_visa",
  "4000056655665556": "pm_card_visa_debit",
  "5555555555554444": "pm_card_mastercard",
  "378282246310005": "pm_card_amex",
  "4000000000000002": "pm_card_chargeDeclined",
  "4000000000000341": "pm_card_chargeCustomerFail",
}

/**
 * The test card a number typed on the hosted Checkout page stands for, spaces and dashes
 * ignored: `4000 0000 0000 0002` declines. A number that is not a test card pays with Visa.
 */
export function checkoutCardFor(number: string | null): string {
  return CHECKOUT_NUMBERS[(number ?? "").replace(/[\s-]/g, "")] ?? CHECKOUT_TEST_CARD
}

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
  const card = TEST_CARDS["pm_card_visa"]

  if (!card) throw new Error("the Visa test card is missing")

  return card
}
