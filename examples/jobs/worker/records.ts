/**
 * What the jobs read and write in Postgres. Each write is safe to run twice, because Inngest runs
 * a step again whenever it threw, even when its transaction had committed and only the answer was
 * lost: a claim finds its own run's claim again, deliveries and charges are keyed by digest and
 * subscriber or batch, and each line of the run history by its job and step.
 */
import { and, asc, eq, lte, ne } from "drizzle-orm"

import { db } from "../db/client.ts"
import { activity, charges, deliveries, digests, subscribers } from "../db/schema.ts"
import { BATCH_SIZE } from "../lib/inngest.ts"

/** A digest the scheduler claimed, with its subscribers in the order they joined. */
export interface Claimed {
  readonly id: string
  readonly subscriberIds: readonly string[]
}

/** `items` in batches of `size`. */
export function batches<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, n) =>
    items.slice(n * size, (n + 1) * size),
  )
}

/**
 * Claims every scheduled digest due by `now` for the scheduler run `runId`, queues a delivery per
 * subscriber, and returns what this run claimed, including what an earlier try of it claimed: a
 * claim that committed but whose answer was lost is found again, not lost.
 */
export function claimDue(runId: string, now: Date): Promise<Claimed[]> {
  return db.transaction(async (tx) => {
    await tx
      .update(digests)
      .set({ status: "sending", claimedBy: runId, claimedAt: now })
      .where(and(eq(digests.status, "scheduled"), lte(digests.sendAt, now)))

    const claimed = await tx
      .select({ id: digests.id })
      .from(digests)
      .where(eq(digests.claimedBy, runId))
    const result: Claimed[] = []

    for (const digest of claimed) {
      const rows = await tx
        .select({ id: subscribers.id })
        .from(subscribers)
        .where(eq(subscribers.digestId, digest.id))
        .orderBy(asc(subscribers.createdAt), asc(subscribers.email))
      const subscriberIds = rows.map((row) => row.id)

      if (subscriberIds.length > 0)
        await tx
          .insert(deliveries)
          .values(subscriberIds.map((subscriberId) => ({ digestId: digest.id, subscriberId })))
          .onConflictDoNothing()

      const count = batches(subscriberIds).length

      await tx
        .insert(activity)
        .values({
          key: `scheduler ${digest.id}`,
          digestId: digest.id,
          job: "scheduler",
          status: "completed",
          detail: `Due, so queued ${subscriberIds.length} ${plural(subscriberIds.length, "email")} in ${count} ${plural(count, "batch", "batches")}`,
          createdAt: now,
        })
        .onConflictDoNothing()
      result.push({ id: digest.id, subscriberIds })
    }

    return result
  })
}

/** `word`, or `many` (default `word` + s) when `n` is not 1. */
export function plural(n: number, word: string, many = `${word}s`): string {
  return n === 1 ? word : many
}

/** One delivery: the digest, and the subscriber it goes to. */
export async function deliveryOf(digestId: string, subscriberId: string) {
  const [row] = await db
    .select({
      title: digests.title,
      intro: digests.intro,
      ownerEmail: digests.ownerEmail,
      email: subscribers.email,
      name: subscribers.name,
    })
    .from(subscribers)
    .innerJoin(digests, eq(digests.id, subscribers.digestId))
    .where(and(eq(subscribers.id, subscriberId), eq(digests.id, digestId)))

  if (!row) throw new Error(`no subscriber ${subscriberId} on digest ${digestId}`)

  return row
}

/** A digest's title, for the line on the team's invoice. */
export async function titleOf(digestId: string): Promise<string> {
  const [row] = await db
    .select({ title: digests.title })
    .from(digests)
    .where(eq(digests.id, digestId))

  return row?.title ?? "a digest"
}

/** A line of the run history, written once per `key`. */
export async function note(line: {
  readonly key: string
  readonly digestId: string
  readonly job: string
  readonly status: "completed" | "retried" | "failed"
  readonly detail: string
  readonly attempt?: number
}): Promise<void> {
  await db
    .insert(activity)
    .values({ ...line, createdAt: new Date() })
    .onConflictDoNothing()
}

/** Marks a delivery sent with Resend's id for the email, once. */
export async function recordSent(
  digestId: string,
  subscriberId: string,
  sent: { readonly emailId: string; readonly tries: number; readonly to: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(deliveries)
      .set({ status: "sent", emailId: sent.emailId, attempts: sent.tries, sentAt: new Date() })
      .where(and(eq(deliveries.digestId, digestId), eq(deliveries.subscriberId, subscriberId)))
    await tx
      .insert(activity)
      .values({
        key: `send-one ${digestId} ${subscriberId}`,
        digestId,
        job: "send-one",
        status: "completed",
        detail: `Sent to ${sent.to}`,
        attempt: sent.tries,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
  })
}

/** Marks a delivery failed for good, unless it went out after all. */
export async function recordFailed(
  digestId: string,
  subscriberId: string,
  error: string,
): Promise<void> {
  await db
    .update(deliveries)
    .set({ status: "failed", error })
    .where(
      and(
        eq(deliveries.digestId, digestId),
        eq(deliveries.subscriberId, subscriberId),
        ne(deliveries.status, "sent"),
      ),
    )
}

/** Notes that the owner was told about a failed delivery, and says so in the run history. */
export async function recordOwnerTold(
  digestId: string,
  subscriberId: string,
  detail: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(deliveries)
      .set({ ownerNotifiedAt: new Date() })
      .where(and(eq(deliveries.digestId, digestId), eq(deliveries.subscriberId, subscriberId)))
    await tx
      .insert(activity)
      .values({
        key: `send-one-failed ${digestId} ${subscriberId}`,
        digestId,
        job: "send-one-failed",
        status: "failed",
        detail,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
  })
}

/** Keeps what one batch was billed, once, and says so in the run history. */
export async function recordCharge(charge: {
  readonly digestId: string
  readonly batch: number
  readonly quantity: number
  readonly amountCents: number
  readonly stripeItemId: string
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(charges)
      .values({ ...charge, createdAt: new Date() })
      .onConflictDoNothing()
    await tx
      .insert(activity)
      .values({
        key: `charge ${charge.digestId} ${charge.batch}`,
        digestId: charge.digestId,
        job: "charge",
        status: "completed",
        detail: `Billed ${charge.quantity} ${plural(charge.quantity, "email")} ($${(charge.amountCents / 100).toFixed(2)}) as ${charge.stripeItemId}`,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
  })
}
