/**
 * Reading a Nylas emulator from a test, and acting as the outside world on it: mail arriving in a
 * connected inbox, or a grant's credentials expiring.
 */
import type { Emulator } from "../define.ts"
import type { NylasEvent, NylasGrant, NylasMessage } from "./entities.ts"
import { NylasEvents } from "./events.ts"
import { grantForEmail } from "./grants.ts"
import { seconds } from "./helpers.ts"
import { fileMessage } from "./mail.ts"
import { nylasStore } from "./store.ts"

export interface NylasApplication {
  /** Every connected grant. */
  grants(): NylasGrant[]
  /** The grant for `email`, if one is connected. */
  grant(email: string): NylasGrant | undefined
  /** The messages in `email`'s mailbox, oldest first; only those in `folder` when given. */
  messages(email: string, folder?: string): NylasMessage[]
  /** What `email` sent through Nylas, oldest first. */
  sent(email: string): NylasMessage[]
  /** The events on `email`'s calendars, oldest first. */
  events(email: string): NylasEvent[]
  /** Mail arriving in `to`'s inbox from outside, announced with `message.created`. */
  receive(to: string, message: { from: string; subject: string; body?: string }): NylasMessage
  /** `email`'s grant stops working: its calls are refused and `grant.expired` goes out. */
  expire(email: string): void
}

/** The Nylas application an emulator stands in for, for tests to read and act on. */
export function nylasApplication(emulator: Emulator): NylasApplication {
  const objects = nylasStore(emulator.store)
  const clock = emulator.store.clock
  const events = new NylasEvents(emulator.outbox, clock, objects.applicationId)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reading and acting register no routes, so the app is never reached
  const context = { objects, events, clock, store: emulator.store, app: undefined as never }

  const grantNamed = (email: string) => {
    const grant = grantForEmail(context, email)

    if (!grant) throw new Error(`no Nylas grant for ${email}`)

    return grant
  }

  const mailbox = (email: string) => {
    const grant = grantForEmail(context, email)

    return grant ? objects.messages.where((m) => m.grant_id === grant.id) : []
  }

  return {
    grants: () => objects.grants.all(),
    grant: (email) => grantForEmail(context, email),
    messages: (email, folder) =>
      mailbox(email).filter((m) => folder === undefined || m.folders.includes(folder)),
    sent: (email) => mailbox(email).filter((m) => m.folders.includes("SENT")),
    events: (email) => {
      const grant = grantForEmail(context, email)

      return grant ? objects.events.where((e) => e.grant_id === grant.id) : []
    },
    receive: (to, message) =>
      fileMessage(
        context,
        grantNamed(to),
        {
          subject: message.subject,
          body: message.body ?? "",
          from: [{ email: message.from }],
          to: [{ email: to }],
        },
        "INBOX",
      ),
    expire(email) {
      const grant = grantNamed(email)
      const expired = objects.grants.change(grant.id, {
        grant_status: "invalid",
        updated_at: seconds(clock),
      })

      events.grant("grant.expired", expired ?? grant)
    },
  }
}
