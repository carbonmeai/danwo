/**
 * The email check Bachs runs on a customer's address. Bachs refuses an address that is malformed
 * or under a special-use name (`.test`, `.local`, …) with `VALIDATION_ERROR`, and one whose domain
 * takes no mail with `EMAIL_NOT_DELIVERABLE`. The emulator cannot look up mail servers, so it
 * refuses only the domains reserved for documentation, which are known to take none.
 */
import { BachsFailure, invalid } from "./helpers.ts"

/** Top-level names reserved for special use, which no email address may sit under. */
const SPECIAL_USE = new Set(["arpa", "invalid", "local", "localhost", "onion", "test"])

/** Domains reserved for documentation: they publish no mail servers. */
const UNDELIVERABLE = ["example.com", "example.net", "example.org"]

function notValid(reason: string): never {
  invalid(`value is not a valid email address: ${reason}`)
}

/** Whether `domain` is, or sits under, a name reserved for documentation. */
function takesNoMail(domain: string): boolean {
  return (
    domain.endsWith(".example") ||
    UNDELIVERABLE.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
  )
}

/** Throws Bachs's refusal for an `email` it would not keep on a customer. */
export function checkEmail(email: string): void {
  const at = email.lastIndexOf("@")

  if (at < 0) notValid("An email address must have an @-sign.")

  const local = email.slice(0, at)
  const domain = email.slice(at + 1).toLowerCase()

  if (!domain.includes("."))
    notValid("The part after the @-sign is not valid. It should have a period.")
  if (local === "" || /\s/.test(email) || /^\.|\.$|\.\./.test(domain))
    notValid("The email address is not valid.")
  if (SPECIAL_USE.has(domain.slice(domain.lastIndexOf(".") + 1)))
    notValid(
      "The part after the @-sign is a special-use or reserved name that cannot be used with email.",
    )
  if (takesNoMail(domain))
    throw new BachsFailure(
      400,
      "EMAIL_NOT_DELIVERABLE",
      `'${email}' cannot receive mail — its domain accepts none. Receipts and payment notices would not arrive.`,
    )
}
