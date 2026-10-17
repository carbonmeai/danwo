/**
 * Where a secret may be typed. Each secret has a purpose, and a purpose allows certain kinds of
 * field: a password only into a password field, a one-time code into a one-time-code or text
 * field, any other secret into any field but a password one. A secret can widen or narrow that
 * with `fields`. Typing into the wrong kind of field is refused before the value is revealed, so
 * a model that picked the wrong field never puts a password where the page would show it.
 */
import type { Locator } from "playwright-core"

import { DanwoError } from "../support/codes.ts"
import type { FieldKind, Secret, SecretPurpose } from "./vault.ts"

/** The kinds each purpose allows. */
const ALLOWED: Readonly<Record<SecretPurpose, readonly FieldKind[]>> = {
  password: ["password"],
  otp: ["one-time-code", "text"],
  totp: ["one-time-code", "text"],
  "generic-secret": ["one-time-code", "text", "other"],
}

/** The kind of the element `locator` points at. */
function fieldKindOf(locator: Locator, timeout: number): Promise<FieldKind> {
  return locator.evaluate(
    (element) => {
      const type = element.getAttribute("type")?.toLowerCase() ?? ""
      const autocomplete = element.getAttribute("autocomplete")?.toLowerCase() ?? ""

      if (type === "password") return "password"
      if (autocomplete.includes("one-time-code")) return "one-time-code"
      if (element.tagName === "TEXTAREA") return "text"
      if (element.tagName === "INPUT")
        return ["", "text", "email", "tel", "number", "search", "url"].includes(type)
          ? "text"
          : "other"

      return element.getAttribute("contenteditable") === null ? "other" : "text"
    },
    undefined,
    { timeout },
  )
}

/** The kinds `secret` may be typed into. */
function allowedKinds(secret: Secret): readonly FieldKind[] | "any" {
  return secret.fields ?? ALLOWED[secret.purpose]
}

/** A secret was about to be typed into a field its purpose does not allow. */
class SecretRefused extends DanwoError {
  constructor(secret: Secret, kind: FieldKind, allowed: readonly FieldKind[]) {
    super(
      "SECRET_REFUSED",
      `refused to type secret "${secret.name}" (purpose ${secret.purpose}) into a ${kind} field; it may go into: ${allowed.join(", ")}. Give the secret another purpose or \`fields\` if this field is right.`,
    )
    this.name = "SecretRefused"
  }
}

/** Throws SecretRefused unless `secret` may be typed into the element `locator` points at. */
export async function checkSecretField(
  locator: Locator,
  secret: Secret,
  timeout: number,
): Promise<void> {
  const allowed = allowedKinds(secret)

  if (allowed === "any") return

  const kind = await fieldKindOf(locator, timeout)

  if (!allowed.includes(kind)) throw new SecretRefused(secret, kind, allowed)
}
