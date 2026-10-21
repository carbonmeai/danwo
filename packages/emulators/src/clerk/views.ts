/**
 * The Clerk shapes a test reads: the instance, its emails and event types, and users, sessions
 * and organizations with the fields tests reach for. The emulator keeps the full Backend API
 * objects; these name what is shown of them.
 */

/** The instance an emulator plays: its slug, keys and the hosts derived from them. */
export interface ClerkInstance {
  readonly slug: string
  /** `<slug>.clerk.accounts.dev`, where browsers and ClerkJS talk to Clerk. */
  readonly frontendApi: string
  /** `<slug>.accounts.dev`, the hosted sign-in pages. */
  readonly accountsHost: string
  readonly publishableKey: string
  readonly secretKeys: readonly string[]
  /** Whether sign-in asks for a password; otherwise an emailed code. */
  readonly password: boolean
  /**
   * The app's origin: the `azp` of tokens minted without a browser `Origin` (the Backend API's
   * session tokens), so an app's `authorizedParties` check passes for them too.
   */
  readonly origin?: string
}

/** An email Clerk sent: verification codes and sign-in links, read by tests. */
export interface ClerkMessage {
  readonly id: string
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly code: string | null
  readonly sent_at: number
}

/** The event types the emulator sends. */
export type ClerkEventType =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "session.created"
  | "session.ended"
  | "session.removed"
  | "session.revoked"
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "organizationMembership.created"
  | "organizationMembership.updated"
  | "organizationMembership.deleted"

/** An email address on a user, and how it was verified. */
export interface ClerkEmailView {
  readonly id: string
  readonly email_address: string
  readonly verification: { readonly status: string; readonly strategy: string } | null
}

/** A user as the Backend API answers it; times are milliseconds since the epoch. */
export interface ClerkUserView {
  readonly id: string
  readonly object: string
  readonly username: string | null
  readonly first_name: string | null
  readonly last_name: string | null
  readonly external_id: string | null
  readonly image_url: string
  readonly has_image: boolean
  readonly primary_email_address_id: string | null
  readonly email_addresses: readonly ClerkEmailView[]
  readonly password_enabled: boolean
  readonly two_factor_enabled: boolean
  readonly public_metadata: Readonly<Record<string, unknown>>
  readonly private_metadata: Readonly<Record<string, unknown>>
  readonly unsafe_metadata: Readonly<Record<string, unknown>>
  readonly banned: boolean
  readonly locked: boolean
  readonly last_sign_in_at: number | null
  readonly last_active_at: number | null
  readonly created_at: number
  readonly updated_at: number
}

/** A session as the Backend API answers it: `active` until it ends, is revoked or expires. */
export interface ClerkSessionView {
  readonly id: string
  readonly object: string
  readonly client_id: string
  readonly user_id: string
  readonly status: string
  readonly last_active_organization_id?: string
  readonly last_active_at: number
  readonly expire_at: number
  readonly abandon_at: number
  readonly created_at: number
  readonly updated_at: number
}

/** An organization as the Backend API answers it. */
export interface ClerkOrganizationView {
  readonly id: string
  readonly object: string
  readonly name: string
  readonly slug: string
  readonly image_url?: string
  readonly has_image: boolean
  readonly members_count?: number
  readonly max_allowed_memberships: number
  readonly public_metadata: Readonly<Record<string, unknown>> | null
  readonly created_by?: string
  readonly created_at: number
  readonly updated_at: number
}
