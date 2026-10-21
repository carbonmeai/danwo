/** What the waitlist's tests share: their fixtures, and the invariant every join must keep. */
import { type DanwoFixtures, type ResendFixtures, resendInbox, test as base } from "@danwo/sdk"

import { WELCOME_SUBJECT } from "../lib/mail.ts"
import { sql } from "./db.ts"

/** The worker's own database, which `danwo.config.ts` hands every test. */
interface WaitlistFixtures {
  readonly databaseUrl: string
}

export const test = base.extend<ResendFixtures & WaitlistFixtures>()

/** What the invariant reads: the fixtures, and the email that joined. */
interface Joined extends ResendFixtures, WaitlistFixtures {
  readonly expect: DanwoFixtures["expect"]
  readonly email: string
}

/**
 * However the join went, `email` ends with exactly one row on the waitlist and exactly one welcome
 * email in the Resend emulator: never none, and never two.
 */
export async function joinedOnce({ databaseUrl, resend, expect, email }: Joined): Promise<void> {
  const rows = await sql(databaseUrl, "select id from signups where email = $1", [email])

  expect(rows).toHaveLength(1)

  /* The email may still be on its way when a fault slowed the join down. */
  const inbox = resendInbox(resend)

  await inbox.waitFor(email)

  const welcomes = inbox.list(email).filter((sent) => sent.subject === WELCOME_SUBJECT)

  expect(welcomes).toHaveLength(1)
}
