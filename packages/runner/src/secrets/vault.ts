/**
 * Secrets a session may type but never show: tests and the model hold a secret by name, the
 * browser gets its value only at the moment it is typed, and every text the session records or
 * sends to a model has the known values replaced first.
 */

/** Where a secret may be typed: anywhere, or (for "password") only into password fields too. */
export type SecretPurpose = "password" | "generic-secret"

/** A secret's value, or a function that produces it each time it is typed. */
export type SecretValue = string | (() => string | Promise<string>)

/** How a session is given a secret: its value alone, or with the purpose it serves. */
export type SessionSecret =
  | SecretValue
  | { readonly value: SecretValue; readonly purpose?: SecretPurpose }

const SECRET = Symbol.for("danwo.secret")

/** An opaque handle on a session's secret; it carries the name, never the value. */
export interface Secret {
  readonly [SECRET]: true
  readonly name: string
  readonly purpose: SecretPurpose
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
}

function entryOf(secret: SessionSecret): Entry {
  if (typeof secret === "object")
    return { value: secret.value, purpose: secret.purpose ?? "generic-secret" }

  return { value: secret, purpose: "generic-secret" }
}

/** One session's secrets: handles by name, values on demand, and redaction of every value seen. */
export class SecretVault {
  private readonly entries = new Map<string, Entry>()
  /** Every value this vault has handed out or was given, longest first, with its secret's name. */
  private known: (readonly [value: string, name: string])[] = []

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

    if (entry === undefined) throw new Error(`secret "${name}" is not in this session's secrets`)

    return { [SECRET]: true, name, purpose: entry.purpose }
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

  /** `text` with every known secret value replaced by `[secret <name>]`. */
  readonly redact = (text: string): string => {
    let out = text

    for (const [value, name] of this.known) {
      if (out.includes(value)) out = out.split(value).join(`[secret ${name}]`)

      const escaped = JSON.stringify(value).slice(1, -1)

      if (escaped !== value && out.includes(escaped))
        out = out.split(escaped).join(`[secret ${name}]`)
    }

    return out
  }

  private remember(name: string, value: string): void {
    if (value.length < MIN_REDACTED_LENGTH || this.known.some(([known]) => known === value)) return

    this.known = [...this.known, [value, name] as const].toSorted(
      (a, b) => b[0].length - a[0].length,
    )
  }
}
