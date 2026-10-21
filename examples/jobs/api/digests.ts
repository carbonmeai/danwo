/**
 * The digest routes: list, create, read one with its subscribers, deliveries, charges and run
 * history, add a subscriber, and schedule a send. Creating takes the id from the page, so a form
 * submitted twice makes one digest; adding a subscriber twice adds them once.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { describe, transaction } from "../db/client.ts"
import { activity, charges, deliveries, digests, subscribers } from "../db/schema.ts"
import { DigestScheduled, inngest } from "../lib/inngest.ts"

/**
 * An address as a browser's email field takes it: `kim@northwind` passes, though Resend wants a
 * dot in the domain. A typo like that is what makes a delivery fail for good.
 */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

const Email = z.string().trim().regex(EMAIL, "Enter an email address.")

const NewDigest = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Give the digest a title.").max(120),
  intro: z.string().trim().max(2_000).default(""),
  ownerEmail: Email,
})

const NewSubscriber = z.object({
  id: z.uuid(),
  email: Email,
  name: z.string().trim().max(120).default(""),
})

const Schedule = z.object({ sendAt: z.iso.datetime({ offset: true }) })

/** What a digest's deliveries add up to. */
interface Tally {
  readonly subscribers: number
  readonly queued: number
  readonly sent: number
  readonly failed: number
}

/** The status a person reads: the stored one, until the deliveries say more. */
function shownStatus(status: string, tally: Tally): string {
  if (status !== "sending") return status
  if (tally.queued > 0) return "sending"

  return tally.failed > 0 ? "sent with failures" : "sent"
}

/** The tallies of the digests `ids`, by digest. */
async function talliesOf(ids: readonly string[]): Promise<Map<string, Tally>> {
  if (ids.length === 0) return new Map()

  const rows = await transaction("tally deliveries", (tx) =>
    tx
      .select({
        digestId: subscribers.digestId,
        subscribers: sql<number>`count(*)::int`,
        queued: sql<number>`count(*) filter (where ${deliveries.status} = 'queued')::int`,
        sent: sql<number>`count(*) filter (where ${deliveries.status} = 'sent')::int`,
        failed: sql<number>`count(*) filter (where ${deliveries.status} = 'failed')::int`,
      })
      .from(subscribers)
      .leftJoin(deliveries, eq(deliveries.subscriberId, subscribers.id))
      .where(inArray(subscribers.digestId, [...ids]))
      .groupBy(subscribers.digestId),
  )

  return new Map(rows.map((row) => [row.digestId, row]))
}

const EMPTY: Tally = { subscribers: 0, queued: 0, sent: 0, failed: 0 }

export const digestRoutes = new Hono()
  .get("/api/digests", async (c) => {
    const rows = await transaction("list digests", (tx) =>
      tx.select().from(digests).orderBy(desc(digests.createdAt)),
    )
    const tallies = await talliesOf(rows.map((row) => row.id))

    return c.json(
      rows.map((row) => {
        const tally = tallies.get(row.id) ?? EMPTY

        return {
          id: row.id,
          title: row.title,
          status: shownStatus(row.status, tally),
          sendAt: row.sendAt,
          ...tally,
        }
      }),
    )
  })
  .post("/api/digests", async (c) => {
    const input = NewDigest.parse(await c.req.json())

    await transaction("create digest", (tx) =>
      tx
        .insert(digests)
        .values({ ...input, createdAt: new Date() })
        .onConflictDoNothing({ target: digests.id }),
    )

    return c.json({ id: input.id }, 201)
  })
  .get("/api/digests/:id", async (c) => {
    const id = z.uuid().parse(c.req.param("id"))
    const found = await transaction("read digest", async (tx) => {
      const [digest] = await tx.select().from(digests).where(eq(digests.id, id))

      if (!digest) return undefined

      return {
        digest,
        subscribers: await tx
          .select({
            id: subscribers.id,
            email: subscribers.email,
            name: subscribers.name,
            status: deliveries.status,
            attempts: deliveries.attempts,
            sentAt: deliveries.sentAt,
            error: deliveries.error,
            ownerNotifiedAt: deliveries.ownerNotifiedAt,
          })
          .from(subscribers)
          .leftJoin(deliveries, eq(deliveries.subscriberId, subscribers.id))
          .where(eq(subscribers.digestId, id))
          .orderBy(asc(subscribers.createdAt), asc(subscribers.email)),
        charges: await tx
          .select()
          .from(charges)
          .where(eq(charges.digestId, id))
          .orderBy(asc(charges.batch)),
        activity: await tx
          .select()
          .from(activity)
          .where(eq(activity.digestId, id))
          .orderBy(asc(activity.createdAt), asc(activity.key)),
      }
    })

    if (!found) return c.json({ error: "No such digest." }, 404)

    const tally = (await talliesOf([id])).get(id) ?? EMPTY

    return c.json({
      ...found,
      digest: { ...found.digest, status: shownStatus(found.digest.status, tally) },
    })
  })
  .post("/api/digests/:id/subscribers", async (c) => {
    const digestId = z.uuid().parse(c.req.param("id"))
    const input = NewSubscriber.parse(await c.req.json())

    await transaction("add subscriber", (tx) =>
      tx
        .insert(subscribers)
        .values({ ...input, digestId, createdAt: new Date() })
        .onConflictDoNothing(),
    )

    return c.json({ id: input.id }, 201)
  })
  .post("/api/digests/:id/schedule", async (c) => {
    const digestId = z.uuid().parse(c.req.param("id"))
    const sendAt = new Date(Schedule.parse(await c.req.json()).sendAt)
    const [scheduled] = await transaction("schedule digest", (tx) =>
      tx
        .update(digests)
        .set({ status: "scheduled", sendAt })
        .where(and(eq(digests.id, digestId), inArray(digests.status, ["draft", "scheduled"])))
        .returning({ id: digests.id }),
    )

    if (!scheduled) return c.json({ error: "That digest has gone out already." }, 409)

    /*
     * The scheduler runs every hour and would find the digest anyway; telling it now means a digest
     * due now goes at once. The SDK retries the send, and the id makes a resend the same event.
     */
    await inngest
      .send(
        DigestScheduled.create({ digestId }, { id: `scheduled-${digestId}-${sendAt.getTime()}` }),
      )
      .catch((error: unknown) => console.warn(`digest/scheduled not sent: ${describe(error)}`))

    return c.json({ id: digestId, sendAt })
  })
