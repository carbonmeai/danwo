/**
 * The digest tables, shared by the API and the worker. `drizzle-kit push` creates them from this
 * file; there are no migration files to keep in step. Ids are random UUIDs, never sequences, so a
 * digest's events and idempotency keys are its own even when a test's rows are put back.
 */
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

const at = (name: string) => timestamp(name, { withTimezone: true })

/** A digest: what goes out, who owns it, and when it is due. */
export const digests = pgTable("digests", {
  id: uuid().primaryKey(),
  title: text().notNull(),
  intro: text().notNull(),
  /** Who hears about a delivery that fails for good. */
  ownerEmail: text("owner_email").notNull(),
  /** `draft`, `scheduled`, then `sending` once the scheduler has claimed it. */
  status: text().notNull().default("draft"),
  sendAt: at("send_at"),
  /** The scheduler run that claimed it: a retry of that run finds its own claim again. */
  claimedBy: text("claimed_by"),
  claimedAt: at("claimed_at"),
  createdAt: at("created_at").notNull().defaultNow(),
})

export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid().primaryKey(),
    digestId: uuid("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    email: text().notNull(),
    name: text().notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("subscribers_digest_email").on(table.digestId, table.email)],
)

/** One subscriber's copy of one digest: queued when the digest is claimed, then sent or failed. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid().primaryKey().defaultRandom(),
    digestId: uuid("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id, { onDelete: "cascade" }),
    /** `queued`, `sent` or `failed`. */
    status: text().notNull().default("queued"),
    /** Resend's id for the email, once it accepted it. */
    emailId: text("email_id"),
    /** How many tries the send took. */
    attempts: integer().notNull().default(0),
    error: text(),
    sentAt: at("sent_at"),
    /** When the owner was told this delivery failed. */
    ownerNotifiedAt: at("owner_notified_at"),
  },
  (table) => [uniqueIndex("deliveries_digest_subscriber").on(table.digestId, table.subscriberId)],
)

/** What one batch of a digest's emails was billed: one Stripe invoice item per batch. */
export const charges = pgTable(
  "charges",
  {
    id: uuid().primaryKey().defaultRandom(),
    digestId: uuid("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    batch: integer().notNull(),
    quantity: integer().notNull(),
    amountCents: integer("amount_cents").notNull(),
    stripeItemId: text("stripe_item_id").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("charges_digest_batch").on(table.digestId, table.batch)],
)

/**
 * The run history: one line per thing a background job did, written by the step that did it.
 * `key` makes the line once per job and step, so a retried step does not write it twice.
 */
export const activity = pgTable("activity", {
  key: text().primaryKey(),
  digestId: uuid("digest_id")
    .notNull()
    .references(() => digests.id, { onDelete: "cascade" }),
  /** The function that ran: `scheduler`, `send-one`, `charge` or `send-one-failed`. */
  job: text().notNull(),
  /** `completed`, `retried` or `failed`. */
  status: text().notNull(),
  detail: text().notNull(),
  /** The try it took, from 1. */
  attempt: integer().notNull().default(1),
  createdAt: at("created_at").notNull().defaultNow(),
})
