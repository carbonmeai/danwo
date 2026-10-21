/**
 * The outbox: background jobs written in the same transaction as what caused them, then sent to
 * Inngest once it commits. A send that fails is tried again, a moment later, until it lands, so a
 * job is never lost; the row's id is the Inngest event id, so a row sent twice (its answer lost,
 * or marking it sent failed) still starts one run.
 */
import { randomUUID } from "node:crypto"

import { asc, inArray, isNull } from "drizzle-orm"

import { broken } from "./bugs.ts"
import { query, type Transaction } from "./db/client.ts"
import { outbox } from "./db/schema.ts"
import { type EventName, inngest } from "./events.ts"
import { describe, retrying } from "./retry.ts"

/** One job to start: the event's name, its data, and the id that makes it happen once. */
export interface Job {
  readonly id: string
  readonly name: EventName
  readonly data: Record<string, unknown>
}

/**
 * Writes `job` to the outbox in `tx`; a second write with the same id is a no-op. With
 * SAAS_BUG=no-webhook-dedupe each write gets a fresh id, so a repeat starts a second run.
 */
export async function enqueue(tx: Transaction, job: Job): Promise<void> {
  const id = broken("no-webhook-dedupe") ? `${job.id}-${randomUUID()}` : job.id

  await tx
    .insert(outbox)
    .values({ id, name: job.name, data: job.data })
    .onConflictDoNothing({ target: outbox.id })
}

/** The flush running now, so two callers never send the same rows at once. */
let running: Promise<number> | undefined

/** Sends every unsent job; the number sent. Throws when Inngest would not take them. */
async function sendPending(): Promise<number> {
  const pending = await query("read the outbox", (db) =>
    db.select().from(outbox).where(isNull(outbox.sentAt)).orderBy(asc(outbox.createdAt)).limit(50),
  )

  if (pending.length === 0) return 0

  await retrying(
    { name: "inngest send", attempts: 4, retryable: () => true, delayMs: (n) => 200 * n },
    () => inngest.send(pending.map((row) => ({ id: row.id, name: row.name, data: row.data }))),
  )
  await query("mark the outbox sent", (db) =>
    db
      .update(outbox)
      .set({ sentAt: new Date() })
      .where(
        inArray(
          outbox.id,
          pending.map((row) => row.id),
        ),
      ),
  )

  return pending.length
}

/** Sends what the outbox holds now; the number sent. Throws when the send failed. */
export function flush(): Promise<number> {
  running = (running ?? Promise.resolve(0)).catch(() => 0).then(() => sendPending())

  return running
}

/** How long to wait before each later try at a send that failed: about a minute in all. */
const LATER_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

/**
 * Flushes now, logging instead of throwing; when the send fails, tries again a little later each
 * time. Whatever caused the jobs is committed already, so they wait safely in the outbox. The
 * promise settles once the first try is over, so a request can answer after its jobs went out.
 */
export async function flushSoon(attempt = 0): Promise<void> {
  try {
    await flush()
  } catch (error) {
    const wait = LATER_MS[attempt]

    if (wait === undefined) {
      console.error(`outbox: gave up sending for now (${describe(error)})`)

      return
    }

    console.warn(`outbox: send failed, trying again in ${wait} ms (${describe(error)})`)
    setTimeout(() => void flushSoon(attempt + 1), wait).unref()
  }
}
