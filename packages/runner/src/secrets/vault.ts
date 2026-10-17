/**
 * Secrets a session may type but never show: tests and the model hold a secret by name, the
 * browser gets its value only at the moment it is typed, and every text the session records or
 * sends to a model has the known values replaced first: as written, and in the forms a value
 * takes on its way through URLs, forms, HTML, JSON and base64 (see variants.ts).
 */
import { DanwoError } from "../support/codes.ts"
import { variantsOf } from "./variants.ts"

/**
 * What a secret is for, which decides the fields it may be typed into (see fields.ts): a
 * `password` only into password fields, an `otp` into one-time-code or text fields, a
 * `generic-secret` (the default) into any field but a password one.
 */
export type SecretPurpose = "password" | "otp" | "generic-secret"

/** What kind of field an element is, as far as secrets go. */
export type FieldKind = "password" | "one-time-code" | "text" | "other"

/** A secret's value, or a function that produces it each time it is typed. */
export type SecretValue = string | (() => string | Promise<string>)

/** How a session is given a secret: its value alone, or with what it is for. */
export type SessionSecret =
  | SecretValue
  | {
      readonly value: SecretValue
      readonly purpose?: SecretPurpose
      /** The kinds of field it may go into instead of its purpose's, or `"any"`. */
      readonly fields?: readonly FieldKind[] | "any"
    }

const SECRET = Symbol.for("danwo.secret")

/** An opaque handle on a session's secret; it carries the name, never the value. */
export interface Secret {
  readonly [SECRET]: true
  readonly name: string
  readonly purpose: SecretPurpose
  /** The fields it may go into when set apart from its purpose's. */
  readonly fields?: readonly FieldKind[] | "any"
}

/** Whether `value` is a secret handle (from any copy of this module). */
export function isSecret(value: unknown): value is Secret {
  return typeof value === "object" && value !== null && SECRET in value
}

/** Values shorter than this are not redacted: replacing "a" or "42" everywhere would erase text. */
const MIN_REDACTED_LENGTH = 4

interface Entry {
  readonly value: SecretValue
  readonly purpose: SecretPurpose
  readonly fields?: readonly FieldKind[] | "any"
}

function entryOf(secret: SessionSecret): Entry {
  if (typeof secret === "object")
    return {
      value: secret.value,
      purpose: secret.purpose ?? "generic-secret",
      ...(secret.fields !== undefined && { fields: secret.fields }),
    }

  return { value: secret, purpose: "generic-secret" }
}

/** One session's secrets: handles by name, values on demand, and redaction of every value seen. */
export class SecretVault {
  private readonly entries = new Map<string, Entry>()
  /**
   * Every value this vault has handed out or was given, longest first, with its secret's name and
   * the patterns that find it in any form.
   */
  private known: (readonly [value: string, name: string, patterns: readonly RegExp[]])[] = []

  constructor(secrets: Readonly<Record<string, SessionSecret>> = {}) {
    for (const [name, secret] of Object.entries(secrets)) {
      const entry = entryOf(secret)

      this.entries.set(name, entry)
      if (typeof entry.value === "string") this.remember(name, entry.value)
    }
  }

  /** The handle of the secret called `name`; throws for a name the session was not given. */
  handle(name: string): Secret {
    const entry = this.entries.get(name)

    if (entry === undefined)
      throw new DanwoError("CONFIG_INVALID", `secret "${name}" is not in this session's secrets`)

    return {
      [SECRET]: true,
      name,
      purpose: entry.purpose,
      ...(entry.fields !== undefined && { fields: entry.fields }),
    }
  }

  /** The value behind `secret`, produced now; it is redacted from then on. */
  async reveal(secret: Secret): Promise<string> {
    const entry = this.entries.get(secret.name)

    if (entry === undefined)
      throw new Error(`secret "${secret.name}" is not in this session's secrets`)

    const value = typeof entry.value === "string" ? entry.value : await entry.value()

    this.remember(secret.name, value)

    return value
  }

  /** Every value revealed or given so far. */
  values(): readonly string[] {
    return this.known.map(([value]) => value)
  }

  /** `text` with every known secret value, in any of its forms, replaced by `[secret <name>]`. */
  readonly redact = (text: string): string => {
    let out = text

    for (const [, name, patterns] of this.known) {
      for (const pattern of patterns) out = out.replace(pattern, `[secret ${name}]`)
    }

    return out
  }

  private remember(name: string, value: string): void {
    if (value.length < MIN_REDACTED_LENGTH || this.known.some(([known]) => known === value)) return

    this.known = [...this.known, [value, name, variantsOf(value)] as const].toSorted(
      (a, b) => b[0].length - a[0].length,
    )
  }
}
