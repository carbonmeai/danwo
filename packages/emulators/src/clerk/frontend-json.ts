import type { SessionJSON } from "@clerk/backend"
import type { SessionJSON as BrowserSessionJSON } from "@clerk/shared/types"

import { signInJson, signUpJson } from "./attempt-json.ts"
import type { ClerkContext } from "./context.ts"
import { type ClerkUser, primaryEmail } from "./entities.ts"
import { membershipJson } from "./organizations.ts"
import { activeSession, isLive, sessionToken } from "./sessions.ts"
import type { ClientRecord } from "./store.ts"

/**
 * A user as the Frontend API shows it to the signed-in browser: the Backend API's user without its
 * private metadata or password-reset flag, with the organizations it belongs to.
 */
function browserUser(context: ClerkContext, user: ClerkUser) {
  const { private_metadata: _private, requires_password_reset: _reset, ...visible } = user
  const memberships = context.clerk.memberships
    .where((m) => m.user_id === user.id)
    .map((m) => membershipJson(context, m))

  return { ...visible, organization_memberships: memberships }
}

/** The public face of a user, as a browser session carries it. */
function publicUserData(user: ClerkUser) {
  return {
    first_name: user.first_name,
    last_name: user.last_name,
    image_url: user.image_url,
    has_image: user.has_image,
    identifier: primaryEmail(user) ?? user.username ?? user.id,
    username: user.username,
    profile_image_url: user.profile_image_url,
  }
}

/** A session as the Frontend API shows it: its user inline and a fresh token. */
export function browserSession(
  context: ClerkContext,
  session: SessionJSON,
  azp: string | undefined,
) {
  const user = context.clerk.users.get(session.user_id)
  const token = {
    object: "token",
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
    user: user ? browserUser(context, user) : null,
    public_user_data: user ? publicUserData(user) : null,
    created_at: session.created_at,
    updated_at: session.updated_at,
  } satisfies Omit<
    BrowserSessionJSON,
    "status" | "user" | "public_user_data" | "last_active_token" | "tasks"
  > & {
    status: string
    user: unknown
    public_user_data: unknown
    last_active_token: unknown
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
    last_authentication_strategy: client.last_authentication_strategy ?? null,
    cookie_expires_at: null,
    captcha_bypass: false,
    created_at: client.created_at,
    updated_at: client.updated_at,
  }
}
