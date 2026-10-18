import type { Store } from "../store.ts"
import { contextOf, type ClerkContext } from "./context.ts"
import { newUser } from "./entities.ts"
import { clerkId, publishableKeyFor } from "./helpers.ts"
import { addMembership, createOrganization } from "./organizations.ts"
import { INSTANCE, type ClerkInstance } from "./store.ts"
import { userByEmail } from "./routes/users.ts"

/** A seeded user: an email address, and a password unless sign-in is by emailed code. */
export interface ClerkSeedUser {
  readonly email: string
  readonly password?: string
  readonly firstName?: string
  readonly lastName?: string
  readonly username?: string
  readonly externalId?: string
  readonly publicMetadata?: Record<string, unknown>
  readonly privateMetadata?: Record<string, unknown>
}

/** A seeded organization and its members by email; the first admin creates it. */
export interface ClerkSeedOrganization {
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

export interface ClerkSeedConfig {
  /**
   * The instance: its slug names the hosts (`<slug>.clerk.accounts.dev`, `<slug>.accounts.dev`),
   * and the publishable key is derived from it. `secretKey` is what the app's server sends.
   * `password: false` makes the Account Portal sign in by emailed code instead.
   */
  readonly instance?: { readonly slug?: string; readonly secretKey?: string; readonly password?: boolean }
  readonly users?: readonly ClerkSeedUser[]
  readonly organizations?: readonly ClerkSeedOrganization[]
  readonly jwtTemplates?: readonly ClerkSeedTemplate[]
}

/** The slug and secret key an emulator uses when the seed names none. */
export const DEFAULT_SLUG = "danwo-app"
export const DEFAULT_SECRET_KEY = "sk_test_danwo_clerk_secret_key"

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
  }
}

function seedUsers(context: ClerkContext, users: readonly ClerkSeedUser[]): void {
  for (const user of users) {
    if (userByEmail(context, user.email)) continue

    const record = newUser(
      {
        emails: [user.email],
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        username: user.username ?? null,
        externalId: user.externalId ?? null,
        hasPassword: user.password !== undefined,
        publicMetadata: user.publicMetadata ?? {},
        privateMetadata: user.privateMetadata ?? {},
      },
      context.clock().getTime(),
    )

    context.clerk.users.add(record, { password: user.password ?? null })
  }
}

function seedOrganizations(context: ClerkContext, orgs: readonly ClerkSeedOrganization[]): void {
  for (const org of orgs) {
    const created = createOrganization(context, { name: org.name, ...(org.slug !== undefined && { slug: org.slug }) })

    for (const member of org.members ?? []) {
      const user = userByEmail(context, member.email)

      if (user) addMembership(context, created.id, user.id, member.role ?? "org:member")
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
 * Seeds a Clerk emulator: the instance (slug and secret key), users with passwords,
 * organizations with members and JWT templates. Call it again after `reset()`.
 */
export function seedClerk(store: Store, config: ClerkSeedConfig): void {
  const context = contextOf(store)

  store.setData(INSTANCE, instanceFrom(config.instance))
  seedUsers(context, config.users ?? [])
  seedOrganizations(context, config.organizations ?? [])
  seedTemplates(context, config.jwtTemplates ?? [])
}
