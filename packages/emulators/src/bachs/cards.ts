/**
 * Sandbox card outcomes: these numbers fail the way their names say; any other number succeeds.
 */
const FAILING: Readonly<Record<string, string>> = {
  "4000000000000002": "declined",
  "4000000000009995": "insufficient_funds",
  "4000000000000069": "expired_card",
  "4000000000000119": "provider_error",
}

/** What a failure reason reads like on the hosted page. */
const MESSAGES: Readonly<Record<string, string>> = {
  declined: "Your card was declined.",
  insufficient_funds: "Your card has insufficient funds.",
  expired_card: "Your card has expired.",
  provider_error: "We could not process your card. Try again.",
}

/** A card number with spaces and dashes taken out. */
export function cardDigits(number: string): string {
  return number.replace(/[\s-]/g, "")
}

/** Why a charge to `number` fails, or null when it goes through. */
export function cardFailure(number: string): string | null {
  return FAILING[cardDigits(number)] ?? null
}

/** The customer-facing message for a failure reason. */
export function failureMessage(reason: string): string {
  return MESSAGES[reason] ?? "Your payment could not be completed."
}

/** The test card the hosted page offers by default. */
export const SUCCESS_CARD = "4242 4242 4242 4242"
