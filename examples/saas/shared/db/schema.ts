/**
 * Relay's tables. `drizzle-kit push` creates them from this file; there are no migration files to
 * keep in step. The API and the worker share them.
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const at = (name: string) => timestamp(name, { withTimezone: true })
const createdAt = () => at("created_at").notNull().defaultNow()

/** A person, by their Clerk user id. */
export const users = pgTable("users", {
  id: text().primaryKey(),
  email: text().notNull(),
  name: text(),
  createdAt: createdAt(),
})

/**
 * A workspace: a Clerk organization, a Stripe customer and a subscription. `onboardingKey` is the
 * key of the form that asked for it, so submitting it twice makes one workspace; each outside id
 * is filled in once, so a retried onboarding picks up where the last attempt stopped.
 */
export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  onboardingKey: text("onboarding_key").notNull().unique(),
  name: text().notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  clerkOrgId: text("clerk_org_id").unique(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  /** The plan's price lookup key, such as `team_monthly`. */
  plan: text().notNull().default("team_monthly"),
  /** Stripe's subscription status, as last read from Stripe. */
  subscriptionStatus: text("subscription_status"),
  trialEndsAt: at("trial_ends_at"),
  currentPeriodEnd: at("current_period_end"),
  /** Whether a card is on file for the subscription. */
  hasPaymentMethod: boolean("has_payment_method").notNull().default(false),
  /** The card on file as the billing page shows it, such as `Visa ending 4242`. */
  card: text(),
  createdAt: createdAt(),
  /** When every outside piece existed: the workspace is ready to use. */
  readyAt: at("ready_at"),
})

/** Who belongs to a workspace, mirrored from the Clerk organization's memberships. */
export const members = pgTable(
  "members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text().notNull(),
    joinedAt: at("joined_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
)

/** An invitation to a workspace, sent by email; its token is the link's secret. */
export const invites = pgTable(
  "invites",
  {
    token: text().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text().notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    acceptedAt: at("accepted_at"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("invites_workspace_email").on(table.workspaceId, table.email)],
)

/**
 * A note: a draft until it is published to the workspace (and its Slack channel). `requestKey` is
 * the key of the form that wrote it, so a retried or doubled submit saves one note.
 */
export const notes = pgTable("notes", {
  id: serial().primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  title: text().notNull(),
  body: text().notNull(),
  publishedAt: at("published_at"),
  createdAt: createdAt(),
})

/**
 * A workspace's connection to Slack or Google: its tokens, who it is on the other side, and, for
 * Slack, the channel notes go to. `status` is `connected` or `needs_attention` (the token stopped
 * working, so someone has to connect it again).
 */
export const integrations = pgTable(
  "integrations",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    status: text().notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: at("expires_at"),
    /** The Slack team or the Google account. */
    externalId: text("external_id").notNull(),
    externalName: text("external_name").notNull(),
    channelId: text("channel_id"),
    channelName: text("channel_name"),
    connectedBy: text("connected_by")
      .notNull()
      .references(() => users.id),
    connectedAt: at("connected_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.provider] })],
)

/** The Slack message a published note became: one per note. */
export const slackPosts = pgTable("slack_posts", {
  noteId: integer("note_id")
    .primaryKey()
    .references(() => notes.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  ts: text().notNull(),
  postedAt: at("posted_at").notNull().defaultNow(),
})

/** Every provider event acted on, by `<provider>:<event id>`, so a repeat delivery is a no-op. */
export const webhookEvents = pgTable("webhook_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  receivedAt: at("received_at").notNull().defaultNow(),
})

/**
 * Background jobs to start, written in the same transaction as what caused them and sent to Inngest
 * after it commits. The id is the Inngest event id, so sending one twice starts one run.
 */
export const outbox = pgTable("outbox", {
  id: text().primaryKey(),
  name: text().notNull(),
  data: jsonb().notNull(),
  createdAt: createdAt(),
  sentAt: at("sent_at"),
})

/** Every email the worker sent, by the idempotency key it sent it with. */
export const emails = pgTable("emails", {
  key: text().primaryKey(),
  kind: text().notNull(),
  to: text().notNull(),
  resendId: text("resend_id").notNull(),
  sentAt: at("sent_at").notNull().defaultNow(),
})
