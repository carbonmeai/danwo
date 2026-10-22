/** What the waitlist's tests share: their fixtures, and the invariant every join must keep. */
import type { DeviceFixtures } from "@danwo/device"
import { type DanwoFixtures, type ResendFixtures, resendInbox, test as base } from "@danwo/sdk"

import { WELCOME_SUBJECT } from "../api/mail.ts"
import { sql } from "./db.ts"

/** The worker's own database, which `danwo.config.ts` hands every test. */
interface WaitlistFixtures {
  readonly databaseUrl: string
}

export const test = base.extend<ResendFixtures & WaitlistFixtures & DeviceFixtures>()

/** What the invariant reads: the fixtures, and the email that joined. */
interface Joined extends ResendFixtures, WaitlistFixtures {
  readonly expect: DanwoFixtures["expect"]
  readonly email: string
}

/**
 * However the join went on the phone, `email` ends with exactly one row on the waitlist and
 * exactly one welcome email in the Resend emulator: never none, and never two.
 */
export async function joinedOnce({ databaseUrl, resend, expect, email }: Joined): Promise<void> {
  /*
   * A fault can slow the join down past the end of the test, so wait for the email first: the API
   * sends it only once the row is saved, so the row is there by then.
   */
  const inbox = resendInbox(resend)

  await inbox.waitFor(email)

  const rows = await sql(databaseUrl, "select id from signups where email = $1", [email])
  const welcomes = inbox.list(email).filter((sent) => sent.subject === WELCOME_SUBJECT)

  expect(rows).toHaveLength(1)
  expect(welcomes).toHaveLength(1)
}
