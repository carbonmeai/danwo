/**
 * Flutterwave's published test cards and what each does on the hosted page: which authorization it
 * asks for, and whether it ends approved or with a processor's refusal. Card numbers and refusals
 * are Flutterwave's test-mode data.
 */

/** The step a card asks for after its details: none, a PIN then an OTP, a bank's OTP, or an address. */
export type CardAuth = "noauth" | "pin" | "3ds" | "avs"

export interface TestCard {
  readonly number: string
  readonly network: string
  readonly auth: CardAuth
  /** Why the processor refuses it; approved when absent. */
  readonly refusal?: string
}

const TEST_CARDS: readonly TestCard[] = [
  { number: "5531886652142950", network: "MASTERCARD", auth: "pin" },
  { number: "5438898014560229", network: "MASTERCARD", auth: "3ds" },
  { number: "4187427415564246", network: "VISA", auth: "3ds" },
  { number: "5640003941605320", network: "AFRIGO", auth: "3ds" },
  { number: "5061460410120223210", network: "VERVE", auth: "pin" },
  { number: "5061460166976054667", network: "VERVE", auth: "noauth" },
  { number: "4556052704172643", network: "VISA", auth: "avs" },
  { number: "5377283645077450", network: "MASTERCARD", auth: "noauth" },
  { number: "5143010522339965", network: "MASTERCARD", auth: "pin", refusal: "Do Not Honour" },
  { number: "5590131743294314", network: "MASTERCARD", auth: "pin", refusal: "Card Fraudulent" },
  { number: "5258585922666506", network: "MASTERCARD", auth: "pin", refusal: "Insufficient Funds" },
  { number: "5640007065275380", network: "AFRIGO", auth: "3ds", refusal: "Insufficient Funds" },
  { number: "5399834697894723", network: "MASTERCARD", auth: "pin", refusal: "Incorrect PIN" },
]

/** OTPs that end a payment in a refusal instead of passing, in test mode. */
export const OTP_REFUSALS: Readonly<Record<string, string>> = {
  "5548": "Wrong OTP",
  "6648": "Insufficient Funds",
}

/** The test card with this number, ignoring spaces. */
export function testCard(number: string): TestCard | undefined {
  const digits = number.replace(/\s+/g, "")

  return TEST_CARDS.find((card) => card.number === digits)
}

/** How Flutterwave names a card's authorization model on its transactions. */
export function authModel(auth: CardAuth): string {
  const models: Record<CardAuth, string> = {
    noauth: "noauth",
    pin: "PIN",
    "3ds": "VBVSECURECODE",
    avs: "AVS_VBVSECURECODE",
  }

  return models[auth]
}

/** Phones that end a mobile money payment in failure, in test mode, by their last digits. */
const FAILING_PHONES = ["121212121", "010101011"]

/** Whether a mobile money payment from `phone` fails. */
export function phoneFails(phone: string): boolean {
  const digits = phone.replace(/\D/g, "")

  return FAILING_PHONES.some((ending) => digits.endsWith(ending))
}

/** The OTP a mobile money payment accepts in test mode. */
export const MOBILE_MONEY_OTP = "123456"
