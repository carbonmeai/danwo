import type { OrganizationInvitationJSON, SessionJSON, SignInTokenJSON } from "@clerk/backend"

import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"
import type { ClerkOrganization, ClerkUser } from "./entities.ts"
import type { SocialConnection, SocialProvider } from "./social.ts"
import type { ClerkInstance, ClerkMessage } from "./views.ts"
import type { ClerkWebhookRecord } from "./webhooks.ts"

/** What the emulator keeps about a user beyond what the API shows. */
interface UserSecrets {
  readonly password: string | null
}

/**
 * A browser's Clerk client: the sessions signed in on it, as the Frontend API's `__client`
 * cookie or a development instance's dev browser identifies it.
 */
export interface ClientRecord {
  readonly id: string
  session_ids: string[]
  last_active_session_id: string | null
  sign_in_id: string | null
  sign_up_id: string | null
  /** The strategy the client last signed in or up with, such as `email_code`. */
  last_authentication_strategy: string | null
  created_at: number
  updated_at: number
  /**
   * When the client last changed, on the apps' clock. The browser is shown this as `updated_at`,
   * since ClerkJS copies it into `__client_uat`, which apps compare with a token's `iat`.
   */
  app_updated_at: number
}

/** A development instance's dev browser: an opaque token that stands in for third-party cookies. */
export interface DevBrowser {
  readonly id: string
  readonly client_id: string
}

/** A handshake's cookie directives, kept until the app's server collects them by nonce. */
interface HandshakeNonce {
  readonly id: string
  readonly directives: readonly string[]
}

/**
 * What the emulator keeps about an invitation beyond what the API shows: the ticket its email
 * links to, and the app page that link lands on.
 */
interface InvitationTicket {
  readonly ticket: string
  readonly redirect_url: string | null
}

/** A user's membership in an organization, as stored; formatted with both sides on the way out. */
export interface MembershipRecord {
  readonly id: string
  readonly organization_id: string
  readonly user_id: string
  role: string
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  readonly created_at: number
  updated_at: number
}

/** A JWT template: extra claims for tokens a session is asked for by name. */
export interface JwtTemplateRecord {
  readonly id: string
  readonly name: string
  claims: Record<string, unknown>
  lifetime: number
  allowed_clock_skew: number
  readonly created_at: number
  updated_at: number
}

/** Who signed in at a social provider, as its profile endpoint answered. */
export interface OAuthProfile {
  readonly provider_user_id: string
  readonly email: string
  readonly first_name: string
  readonly last_name: string
  readonly image_url: string
  /** The scopes the instance asked for, which the provider granted. */
  readonly scopes: string
}

/**
 * A social sign-in or sign-up in flight: the state the provider sends back, where the browser
 * goes after the callback, and how it came back. `transferable` means the provider account fits
 * no user (a sign-in, so ClerkJS signs up instead) or already has one (a sign-up, so it signs in).
 */
export interface OAuthState {
  readonly provider: SocialProvider
  readonly state: string
  /** The PKCE verifier whose S256 challenge went to the provider. */
  readonly code_verifier: string
  readonly redirect_url: string
  readonly action_complete_redirect_url: string | null
  readonly status: "unverified" | "verified" | "transferable" | "failed"
  /** Why it is transferable or failed, as Clerk's error code. */
  readonly error: string | null
  readonly profile: OAuthProfile | null
}

/** A sign-in or sign-up the Frontend API is walking a browser through. */
export interface AttemptRecord {
  readonly id: string
  readonly kind: "sign_in" | "sign_up"
  readonly client_id: string
  identifier: string
  user_id: string | null
  status: "needs_identifier" | "needs_first_factor" | "missing_requirements" | "complete"
  /** The first factor (or, for a sign-up, the verification) being worked on: `password` or `email_code`. */
  strategy: string | null
  /** The session a completed attempt started. */
  created_session_id: string | null
  /** The code emailed for this attempt, if one was sent. */
  code: string | null
  /** When the code was sent; it expires ten minutes later. */
  code_sent_at: number | null
  attempts: number
  /** A sign-up's chosen password, kept until the user is created. */
  password: string | null
  first_name: string | null
  last_name: string | null
  /** The invitation ticket a `ticket` sign-in or sign-up came with; it verifies the email. */
  ticket: string | null
  /** A social sign-in or sign-up's round trip to the provider; null for the other strategies. */
  oauth: OAuthState | null
  readonly created_at: number
}

/** A seeded signing key (PKCS#8 PEM) that replaces the emulator's own, so tokens verify across runs. */
export const SIGNING_KEY: DataKey<string> = { name: "clerk.signing_key" }

/** The social connections the instance offers, such as Google. */
export const SOCIAL: DataKey<readonly SocialConnection[]> = { name: "clerk.social" }

/** The instance, read with `instanceOf`. */
export const INSTANCE: DataKey<ClerkInstance> = { name: "clerk.instance" }

/** Every table a Clerk emulator keeps. */
export function clerkStore(store: Store) {
  return {
    users: objectTable<ClerkUser, UserSecrets>(store, "clerk.users"),
    sessions: objectTable<SessionJSON>(store, "clerk.sessions"),
    clients: objectTable<ClientRecord>(store, "clerk.clients"),
    devBrowsers: objectTable<DevBrowser>(store, "clerk.dev_browsers"),
    nonces: objectTable<HandshakeNonce>(store, "clerk.handshake_nonces"),
    organizations: objectTable<ClerkOrganization>(store, "clerk.organizations"),
    memberships: objectTable<MembershipRecord>(store, "clerk.memberships"),
    invitations: objectTable<OrganizationInvitationJSON, InvitationTicket>(
      store,
      "clerk.organization_invitations",
    ),
    signInTokens: objectTable<SignInTokenJSON>(store, "clerk.sign_in_tokens"),
    jwtTemplates: objectTable<JwtTemplateRecord>(store, "clerk.jwt_templates"),
    attempts: objectTable<AttemptRecord>(store, "clerk.attempts"),
    messages: objectTable<ClerkMessage>(store, "clerk.messages"),
    webhooks: objectTable<ClerkWebhookRecord>(store, "clerk.webhooks"),
  }
}

export type ClerkStore = ReturnType<typeof clerkStore>
