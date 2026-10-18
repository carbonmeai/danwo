import type { SessionJSON } from "@clerk/backend"
import type {
  PublicUserDataJSON,
  SessionJSON as BrowserSessionJSON,
  TokenJSON,
  UserJSON as BrowserUserJSON,
} from "@clerk/shared/types"

import { signInJson, signUpJson } from "./attempt-json.ts"
import type { ClerkContext } from "./context.ts"
import { type ClerkEmail, type ClerkUser, primaryEmail } from "./entities.ts"
import { membershipJson } from "./organizations.ts"
import { activeSession, isLive, sessionToken } from "./sessions.ts"
import type { ClientRecord } from "./store.ts"

/** A verification as the Frontend API shows it: Clerk sends `error: null` when there is none. */
interface BrowserVerification {
  readonly object: "verification"
  readonly id: string
  readonly status: string
  readonly strategy: string
  readonly attempts: number | null
  readonly expire_at: number | null
  readonly verified_at_client: string | null
  readonly error: null
}

/** A verified identifier's verification. */
function verified(strategy: string): BrowserVerification {
  return {
    object: "verification",
    id: "",
    status: "verified",
    strategy,
    attempts: null,
    expire_at: null,
    verified_at_client: null,
    error: null,
  }
}

/** An email address as the Frontend API shows it. */
function emailJson(email: ClerkEmail) {
  return {
    object: "email_address" as const,
    id: email.id,
    email_address: email.email_address,
    verification: verified(email.verification?.strategy ?? "email_code"),
    linked_to: email.linked_to,
    matches_sso_connection: false,
  }
}

/**
 * A user as the Frontend API shows it to the signed-in browser: no private metadata, with
 * passkeys and the profile image id the browser SDK reads.
 */
function browserUser(context: ClerkContext, user: ClerkUser) {
  const memberships = context.clerk.memberships
    .where((m) => m.user_id === user.id)
    .map((m) => membershipJson(context, m))

  return {
    object: "user",
    id: user.id,
    external_id: user.external_id,
    primary_email_address_id: user.primary_email_address_id,
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    image_url: user.image_url,
    has_image: user.has_image,
    username: user.username,
    email_addresses: user.email_addresses.map(emailJson),
    phone_numbers: [],
    web3_wallets: [],
    external_accounts: [],
    enterprise_accounts: [],
    passkeys: [],
    organization_memberships: memberships,
    password_enabled: user.password_enabled,
    profile_image_id: "",
    first_name: user.first_name,
    last_name: user.last_name,
    totp_enabled: false,
    backup_code_enabled: false,
    two_factor_enabled: false,
    public_metadata: user.public_metadata,
    unsafe_metadata: user.unsafe_metadata,
    last_sign_in_at: user.last_sign_in_at,
    create_organization_enabled: user.create_organization_enabled,
    create_organizations_limit: user.create_organizations_limit,
    delete_self_enabled: user.delete_self_enabled,
    legal_accepted_at: user.legal_accepted_at,
    timezone: user.timezone,
    updated_at: user.updated_at,
    created_at: user.created_at,
  } satisfies Omit<BrowserUserJSON, "email_addresses" | "organization_memberships"> & {
    email_addresses: unknown[]
    organization_memberships: unknown[]
  }
}

/** The public face of a user, as sessions and memberships carry it. */
function publicUserData(user: ClerkUser): PublicUserDataJSON {
  return {
    first_name: user.first_name,
    last_name: user.last_name,
    image_url: user.image_url,
    has_image: user.has_image,
    identifier: primaryEmail(user) ?? user.username ?? user.id,
    user_id: user.id,
    ...(user.username !== null && { username: user.username }),
  }
}

/** A session as the Frontend API shows it: its user inline and a fresh token. */
export function browserSession(
  context: ClerkContext,
  session: SessionJSON,
  azp: string | undefined,
) {
  const user = context.clerk.users.get(session.user_id)
  const token: TokenJSON = {
    object: "token",
    id: "",
    jwt: isLive(context, session) ? sessionToken(context, session, azp) : "",
  }

  return {
    object: "session",
    id: session.id,
    status: session.status,
    factor_verification_age: [0, -1],
    expire_at: session.expire_at,
    abandon_at: session.abandon_at,
    last_active_at: session.last_active_at,
    last_active_token: token,
    last_active_organization_id: session.last_active_organization_id || null,
    actor: null,
    tasks: null,
    user: user ? browserUser(context, user) : null,
    public_user_data: user ? publicUserData(user) : null,
    created_at: session.created_at,
    updated_at: session.updated_at,
  } satisfies Omit<BrowserSessionJSON, "status" | "user" | "public_user_data"> & {
    status: string
    user: unknown
    public_user_data: unknown
  }
}

/** A client as the Frontend API shows it, with its live sessions and the attempts in progress. */
export function browserClient(
  context: ClerkContext,
  client: ClientRecord,
  azp: string | undefined,
) {
  const sessions = client.session_ids
    .flatMap((id) => context.clerk.sessions.get(id) ?? [])
    .filter((s) => isLive(context, s))
    .map((s) => browserSession(context, s, azp))
  const signIn =
    client.sign_in_id === null ? undefined : context.clerk.attempts.get(client.sign_in_id)
  const signUp =
    client.sign_up_id === null ? undefined : context.clerk.attempts.get(client.sign_up_id)

  return {
    object: "client",
    id: client.id,
    sessions,
    sign_in: signIn ? signInJson(context, signIn) : null,
    sign_up: signUp ? signUpJson(context, signUp) : null,
    last_active_session_id: activeSession(context, client)?.id ?? null,
    last_authentication_strategy: null,
    cookie_expires_at: null,
    captcha_bypass: false,
    created_at: client.created_at,
    updated_at: client.updated_at,
  }
}
