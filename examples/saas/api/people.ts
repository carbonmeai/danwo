/**
 * Relay's users, mirrored from Clerk. A user's row is made the first time Relay hears of them,
 * from Clerk's `user.created` webhook or their first signed-in request, whichever comes first, and
 * the welcome email is queued in the same transaction, so it goes out once however they arrive.
 */
import { eq } from "drizzle-orm"

import { query, transaction } from "../shared/db/client.ts"
import { users } from "../shared/db/schema.ts"
import { userSignedUp } from "../shared/events.ts"
import { enqueue, flushSoon } from "../shared/outbox.ts"
import { clerk, clerkCall } from "./clerk.ts"

/** What Relay keeps of a person. */
export interface Person {
  readonly id: string
  readonly email: string
  readonly name: string | null
}

/** The first and last name Clerk holds, joined; null when there is neither. */
export function fullName(first: string | null, last: string | null): string | null {
  return [first, last].filter(Boolean).join(" ") || null
}

/** Saves `person` unless they are known already, queueing their welcome email the first time. */
export async function rememberUser(person: Person): Promise<void> {
  await transaction("remember user", async (tx) => {
    const [made] = await tx
      .insert(users)
      .values(person)
      .onConflictDoNothing({ target: users.id })
      .returning({ id: users.id })

    if (made)
      await enqueue(tx, {
        id: `welcome-${person.id}`,
        name: userSignedUp.name,
        data: { userId: person.id, email: person.email, name: person.name },
      })
  })
  /* Also when an earlier attempt's COMMIT landed with its answer lost: its job is waiting. */
  await flushSoon()
}

/** The user `id`, saved first when this is the first Relay has heard of them. */
export async function ensureUser(id: string): Promise<Person> {
  const [known] = await query("read user", (db) => db.select().from(users).where(eq(users.id, id)))

  if (known) return known

  const user = await clerkCall("get user", () => clerk.users.getUser(id))
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress

  if (!email) throw new Error(`user ${id} has no email address`)

  const person = { id, email, name: fullName(user.firstName, user.lastName) }

  await rememberUser(person)

  return person
}
