/**
 * Why Paystack refuses a call. Every failure carries a machine-readable `code` and a `meta.nextStep`
 * telling the developer what to change, beside the `message` people read.
 */
export interface Problem {
  readonly code: string
  readonly nextStep: string
}

const VALID_VALUES = "Ensure that the value(s) you're passing are valid."
const EXISTING_RESOURCE =
  "Ensure that you're passing the correct reference for the requested resource that exists on this integration"
const EXISTING_TRANSACTION =
  "Ensure that you're passing the reference of a transaction that exists on this integration"

/** The problems the emulator answers with, by the `code` Paystack gives each. */
export const PROBLEMS = {
  badKey: {
    code: "invalid_Key",
    nextStep: "Ensure that you provide the correct authorization key for the request",
  },
  badAuthorizationHeader: {
    code: "secret_key_invalid",
    nextStep:
      "Ensure that the authorization header follows the format: \"Bearer YOUR_SECRET_KEY\". Ex. 'Authorization: Bearer sk_123456789'",
  },
  invalidParams: { code: "invalid_params", nextStep: VALID_VALUES },
  missingParams: { code: "missing_params", nextStep: "Provide all required params " },
  invalidAmount: {
    code: "invalid_amount",
    nextStep:
      "Ensure that you're passing your amount correctly. It should be a number greater than zero, with no decimal places",
  },
  notFound: { code: "not_found", nextStep: EXISTING_RESOURCE },
  transactionNotFound: { code: "transaction_not_found", nextStep: EXISTING_TRANSACTION },
  refundTransactionNotFound: {
    code: "transaction_not_found",
    nextStep: "Ensure the transaction reference or ID is correct",
  },
  customerNotFound: {
    code: "customer_not_found",
    nextStep:
      "Ensure that you're passing the customer code or email of a customer that exists on the integration",
  },
  invalidAuthorizationCode: {
    code: "invalid_authorization_code",
    nextStep:
      "Ensure your request doesn't contain an empty authorization. Also make sure you're using the right authorization code for the customer you're trying to charge",
  },
  invalidBankCode: {
    code: "invalid_bank_code",
    nextStep:
      "Ensure that you're passing the correct bank code. Use the List Banks Endpoint to get the list of all available banks and their corresponding bank codes",
  },
  serverError: {
    code: "unknown",
    nextStep: "Try the request again. If it keeps failing, contact Paystack support",
  },
} as const satisfies Record<string, Problem>

/** The problem a failure has when its route names none: by its HTTP status. */
export function problemFor(status: number): Problem {
  if (status >= 500) return PROBLEMS.serverError
  if (status === 404) return PROBLEMS.notFound

  return PROBLEMS.invalidParams
}
