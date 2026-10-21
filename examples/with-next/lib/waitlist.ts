import { query } from "./db.ts"
import { sendWelcome } from "./mail.ts"

/** What joining answers: a new seat, or one the email already had. */
export interface Joined {
  readonly status: "joined" | "already"
  /** How many people are on the waitlist now. */
  readonly count: number
}

/** A forgiving check, as the browser's own `type="email"` makes: something@something.tld. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The email, trimmed and lowercased, or undefined when it is not an address. */
export function normalEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined

  const email = value.trim().toLowerCase()

  return EMAIL.test(email) && email.length <= 254 ? email : undefined
}

/** How many people are on the waitlist. */
export async function waitlistCount(): Promise<number> {
  const [row] = await query<{ count: number }>("select count(*)::int as count from signups")

  return row?.count ?? 0
}

/**
 * Puts `email` on the waitlist and welcomes it, once. Every step is safe to repeat, so a retry,
 * a double click or two tabs end with one row and one email:
 *
 * 1. the upsert keeps one row per email (`unique`), and returns it whether or not it was new;
 * 2. a row not yet welcomed gets the welcome email, keyed by the row so Resend sends it once;
 * 3. the row is marked welcomed. A row already welcomed is a duplicate, and gets no email.
 */
export async function join(email: string): Promise<Joined> {
  const [row] = await query<{ id: string; welcomed: boolean }>(
    `insert into signups (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id::text, welcomed_at is not null as welcomed`,
    [email],
  )

  if (row === undefined) throw new Error("the upsert returned no row")

  if (!row.welcomed) {
    await sendWelcome(row.id, email)
    await query("update signups set welcomed_at = coalesce(welcomed_at, now()) where id = $1", [
      row.id,
    ])
  }

  return { status: row.welcomed ? "already" : "joined", count: await waitlistCount() }
}
