/**
 * The test cards Paystack documents for test mode, and what each does on the hosted page: pay at
 * once, ask for a PIN, ask for a PIN and then an OTP, or be declined. The PIN and OTP each card
 * expects are part of the published test data.
 */

export interface TestCard {
  readonly number: string
  readonly brand: "visa" | "verve" | "mastercard"
  /** The PIN the card asks for, when it asks. */
  readonly pin: string | null
  /** The one-time code it asks for after the PIN, when it asks. */
  readonly otp: string | null
  /** The bank's answer when the card is declined. */
  readonly declined: string | null
}

const CARDS: readonly TestCard[] = [
  { number: "4084084084084081", brand: "visa", pin: null, otp: null, declined: null },
  { number: "5060666666666666666", brand: "verve", pin: "1234", otp: null, declined: null },
  { number: "507850785078507812", brand: "verve", pin: "1111", otp: "123456", declined: null },
  {
    number: "4084080000005408",
    brand: "visa",
    pin: null,
    otp: null,
    declined: "Declined",
  },
  {
    number: "5399838383838381",
    brand: "mastercard",
    pin: null,
    otp: null,
    declined: "Insufficient Funds",
  },
]

/** The test card with `number` (spaces ignored); undefined for a number Paystack would reject in test mode. */
export function testCard(number: string): TestCard | undefined {
  const digits = number.replaceAll(/\D/g, "")

  return CARDS.find((card) => card.number === digits)
}

/** The numbers, for the hosted page's hint. */
export function testCardNumbers(): readonly string[] {
  return CARDS.map((card) => card.number)
}
