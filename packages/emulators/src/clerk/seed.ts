import { createHash } from "node:crypto"

import type { Store } from "../store.ts"
import { contextOf, type ClerkContext } from "./context.ts"
import { type ClerkUser, newUser } from "./entities.ts"
import { clerkId, publishableKeyFor, stableClerkId } from "./helpers.ts"
import { addMembership, createOrganization } from "./organizations.ts"
import { userByEmail } from "./routes/users.ts"
import { INSTANCE, SIGNING_KEY, type ClerkInstance } from "./store.ts"

/**
 * A seeded user: an email address, and a password unless sign-in is by emailed code. Its id is
 * `id` when given, otherwise derived from the email address, so it is the same on every run and
 * after every reset, and matches rows an app's own database was seeded with.
 */
export interface ClerkSeedUser {
  readonly id?: string
  readonly email: string
  readonly password?: string
  readonly firstName?: string
  readonly lastName?: string
  readonly username?: string
  readonly externalId?: string
  readonly publicMetadata?: Record<string, unknown>
  readonly privateMetadata?: Record<string, unknown>
}

/**
 * A seeded organization and its members by email; the first admin creates it. Its id is `id`
 * when given, otherwise derived from its slug (or name), stable across runs like a user's.
 */
export interface ClerkSeedOrganization {
  readonly id?: string
  readonly name: string
  readonly slug?: string
  readonly members?: readonly { readonly email: string; readonly role?: string }[]
}

/** A seeded JWT template. */
export interface ClerkSeedTemplate {
  readonly name: string
  readonly claims: Record<string, unknown>
  readonly lifetime?: number
}

/**
 * An endpoint Clerk delivers webhooks to, signed the Svix way (`svix-id`, `svix-timestamp`,
 * `svix-signature`). `secret` is the `whsec_` signing secret the app verifies with
 * (`CLERK_WEBHOOK_SIGNING_SECRET`); when not given, one derived from the instance and the
 * endpoint, the same on every run (read it with `clerkInstance(clerk).webhookSecret()`).
 * `events` limits the event types it gets; every event when not given. `headers` are sent with
 * every delivery, as a Svix endpoint's custom headers are (an app that also checks a shared
 * token of its own).
 */
export interface ClerkSeedWebhook {
  readonly endpoint: string
  readonly events?: readonly string[]
  readonly secret?: string
  readonly headers?: Readonly<Record<string, string>>
}

/** A Clerk emulator's seed: the instance, and the users, organizations and JWT templates it starts with. */
export interface ClerkSeedConfig {
  /**
   * The instance: its slug names the hosts (`<slug>.clerk.accounts.dev`, `<slug>.accounts.dev`),
   * and the publishable key is derived from it. `secretKey` is what the app's server sends.
   * `password: false` makes sign-in (the Account Portal and `<SignIn/>`) use an emailed code.
   * `origin` is the app's own origin, the `azp` of tokens minted without a browser (the Backend
   * API's). `signingKey` (a PKCS#8 PEM) replaces the emulator's own key, so an app configured
   * with its public key (`CLERK_PEM_PUBLIC_KEY`) keeps verifying tokens across runs.
   */
  readonly instance?: {
    readonly slug?: string
    readonly secretKey?: string
    readonly password?: boolean
    readonly origin?: string
    readonly signingKey?: string
  }
  readonly users?: readonly ClerkSeedUser[]
  readonly organizations?: readonly ClerkSeedOrganization[]
  readonly jwtTemplates?: readonly ClerkSeedTemplate[]
  readonly webhooks?: readonly ClerkSeedWebhook[]
  /**
   * Sends `user.created`, `organization.created` and `organizationMembership.created` for the
   * seeded records, as if they had just been made, so an app that creates its own rows from
   * Clerk's webhooks has them. Off by default: seeded records are there from the start.
   */
  readonly announce?: boolean
}

/** The slug and secret key an emulator uses when the seed names none. */
const DEFAULT_SLUG = "danwo-app"
const DEFAULT_SECRET_KEY = "REDACTED-TEST-VALUE"

/** The instance a seed describes. */
export function instanceFrom(config: ClerkSeedConfig["instance"] = {}): ClerkInstance {
  const slug = config.slug ?? DEFAULT_SLUG
  const frontendApi = `${slug}.clerk.accounts.dev`

  return {
    slug,
    frontendApi,
    accountsHost: `${slug}.accounts.dev`,
    publishableKey: publishableKeyFor(frontendApi),
    secretKeys: [config.secretKey ?? DEFAULT_SECRET_KEY],
    password: config.password ?? true,
    ...(config.origin !== undefined && { origin: config.origin }),
  }
}

/** A seeded user's record, with stable ids for it and its email address. */
function seededUser(context: ClerkContext, user: ClerkSeedUser): ClerkUser {
  const record = newUser(
    {
      emails: [user.email],
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      externalId: user.externalId,
      hasPassword: user.password !== undefined,
      publicMetadata: user.publicMetadata,
      privateMetadata: user.privateMetadata,
    },
    context.clock().getTime(),
  )
  const email = user.email.toLowerCase()
  const emails = record.email_addresses.map((address) => ({
    ...address,
    id: stableClerkId("idn", address.email_address.toLowerCase()),
  }))

  return {
    ...record,
    id: user.id ?? stableClerkId("user", email),
    email_addresses: emails,
    primary_email_address_id: emails[0]?.id ?? null,
  }
}

function seedUsers(context: ClerkContext, users: readonly ClerkSeedUser[]): void {
  for (const user of users) {
    if (userByEmail(context, user.email)) continue

    const record = context.clerk.users.add(seededUser(context, user), {
      password: user.password ?? null,
    })

    context.events.user("user.created", record)
  }
}

function seedOrganizations(context: ClerkContext, orgs: readonly ClerkSeedOrganization[]): void {
  for (const org of orgs) {
    const key = org.slug ?? org.name
    const created = createOrganization(context, {
      id: org.id ?? stableClerkId("org", key),
      name: org.name,
      ...(org.slug !== undefined && { slug: org.slug }),
    })

    for (const member of org.members ?? []) {
      const user = userByEmail(context, member.email)
      const id = stableClerkId("orgmem", `${key}:${member.email.toLowerCase()}`)

      if (user) addMembership(context, created.id, user.id, member.role ?? "org:member", id)
    }
  }
}

function seedTemplates(context: ClerkContext, templates: readonly ClerkSeedTemplate[]): void {
  const at = context.clock().getTime()

  for (const template of templates)
    context.clerk.jwtTemplates.add(
      {
        id: clerkId("jtmp"),
        name: template.name,
        claims: template.claims,
        lifetime: template.lifetime ?? 60,
        allowed_clock_skew: 5,
        created_at: at,
        updated_at: at,
      },
      null,
    )
}

/**
 * The signing secret of an endpoint seeded without one: derived from the instance and the
 * endpoint, so it is the same after every reset and the app can be configured with it once.
 */
function defaultWebhookSecret(slug: string, endpoint: string): string {
  const bytes = createHash("sha256").update(`clerk-webhook:${slug}:${endpoint}`).digest()

  return `whsec_${bytes.subarray(0, 24).toString("base64")}`
}

function seedWebhooks(context: ClerkContext, webhooks: readonly ClerkSeedWebhook[]): void {
  const slug = context.store.getData(INSTANCE)?.slug ?? DEFAULT_SLUG

  for (const hook of webhooks)
    context.clerk.webhooks.add(
      {
        id: stableClerkId("whk", hook.endpoint),
        url: hook.endpoint,
        events: hook.events ?? [],
        secret: hook.secret ?? defaultWebhookSecret(slug, hook.endpoint),
        enabled: true,
        ...(hook.headers !== undefined && { headers: hook.headers }),
      },
      null,
    )
}

/**
 * Seeds a Clerk emulator: the instance (slug, secret key, origin and signing key), users with
 * passwords, organizations with members, JWT templates and webhook endpoints. Seeded users and
 * organizations get ids that stay the same across runs. Call it again after `reset()`.
 */
export function seedClerk(store: Store, config: ClerkSeedConfig): void {
  const context = contextOf(store)

  /** The users and organizations, with their memberships. */
  function records(): void {
    seedUsers(context, config.users ?? [])
    seedOrganizations(context, config.organizations ?? [])
  }

  store.setData(INSTANCE, instanceFrom(config.instance))
  if (config.instance?.signingKey !== undefined)
    store.setData(SIGNING_KEY, config.instance.signingKey)
  seedWebhooks(context, config.webhooks ?? [])
  if (config.announce === true) records()
  else context.events.quietly(records)
  seedTemplates(context, config.jwtTemplates ?? [])
}
