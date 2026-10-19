import type { SessionJSON } from "@clerk/backend"

import { type ClerkContext, instanceOf, now, signingKeyOf } from "./context.ts"
import { clerkId, notFound } from "./helpers.ts"
import type { ClientRecord } from "./store.ts"

/** How long a session lasts before Clerk expires it: seven days. */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/** How long a session token is valid: Clerk's short-lived 60 seconds. */
const TOKEN_LIFETIME_S = 60

/** A new client, the record a browser's sign-ins and sessions hang off. */
export function newClient(context: ClerkContext): ClientRecord {
  const at = now(context)

  return context.clerk.clients.add(
    {
      id: clerkId("client"),
      session_ids: [],
      last_active_session_id: null,
      sign_in_id: null,
      sign_up_id: null,
      last_authentication_strategy: null,
      created_at: at,
      updated_at: at,
    },
    null,
  )
}

/** Starts a session for `userId` on `client` and makes it the client's active one. */
export function startSession(
  context: ClerkContext,
  client: ClientRecord,
  userId: string,
): SessionJSON {
  const at = now(context)
  const session = context.clerk.sessions.add(
    {
      object: "session",
      id: clerkId("sess"),
      client_id: client.id,
      user_id: userId,
      status: "active",
      actor: null,
      last_active_at: at,
      expire_at: at + SESSION_LIFETIME_MS,
      abandon_at: at + 2 * SESSION_LIFETIME_MS,
      created_at: at,
      updated_at: at,
    },
    null,
  )

  context.clerk.users.change(userId, { last_active_at: at })
  context.clerk.clients.change(client.id, {
    session_ids: [...client.session_ids, session.id],
    last_active_session_id: session.id,
    sign_in_id: null,
    sign_up_id: null,
    updated_at: at,
  })
  context.clerk.users.change(userId, { last_sign_in_at: at, last_active_at: at })
  context.events.session("session.created", session)

  return session
}

/** Whether a session can still mint tokens: active and not expired by the emulator's clock. */
export function isLive(context: ClerkContext, session: SessionJSON): boolean {
  return session.status === "active" && session.expire_at > now(context)
}

/** Ends a session with `status` (`revoked`, `ended`, `removed`) and drops it from its client. */
export function endSession(
  context: ClerkContext,
  id: string,
  status: "revoked" | "ended" | "removed",
): SessionJSON {
  const session = context.clerk.sessions.get(id)

  if (!session) throw notFound("session")

  const at = now(context)
  const ended = context.clerk.sessions.change(id, { status, updated_at: at }) ?? session
  const client = context.clerk.clients.get(session.client_id)

  if (client) {
    const remaining = client.session_ids.filter((sid) => sid !== id)

    context.clerk.clients.change(client.id, {
      session_ids: remaining,
      last_active_session_id:
        client.last_active_session_id === id
          ? (remaining.at(-1) ?? null)
          : client.last_active_session_id,
      updated_at: at,
    })
  }

  context.events.session(`session.${status}`, ended)

  return ended
}

/** The organization a session's token carries, from its last active organization (empty when none). */
function organizationClaim(context: ClerkContext, session: SessionJSON) {
  const orgId = session.last_active_organization_id

  if (orgId === undefined || orgId === "") return {}

  const org = context.clerk.organizations.get(orgId)
  const membership = context.clerk.memberships.where(
    (m) => m.organization_id === orgId && m.user_id === session.user_id,
  )[0]

  if (!org || !membership) return {}

  return { v: 2, o: { id: org.id, rol: membership.role.replace(/^org:/, ""), slg: org.slug } }
}

/** The claims of a session token: who, which session, which app, and a minute of validity. */
export function sessionClaims(
  context: ClerkContext,
  session: SessionJSON,
  azp: string | undefined,
): Record<string, unknown> {
  const iat = Math.floor(context.wallClock().getTime() / 1000)
  const party = azp ?? instanceOf(context).origin

  return {
    ...(party !== undefined && { azp: party }),
    exp: iat + TOKEN_LIFETIME_S,
    fva: [0, -1],
    iat,
    iss: `https://${instanceOf(context).frontendApi}`,
    nbf: iat - 10,
    sid: session.id,
    sts: "active",
    sub: session.user_id,
    ...organizationClaim(context, session),
  }
}

/**
 * The header fields Clerk adds to a session token: the client attestation tag and the time the
 * token's session was first issued.
 */
export function sessionHeader(claims: Record<string, unknown>): Record<string, unknown> {
  return { cat: CLIENT_ATTESTATION, oiat: claims["iat"] }
}

/** The client attestation tag Clerk's development instances put in session token headers. */
const CLIENT_ATTESTATION = "cl_B7d4PD111AAA"

/** A signed session token for a live session. */
export function sessionToken(context: ClerkContext, session: SessionJSON, azp?: string): string {
  const claims = sessionClaims(context, session, azp)

  return signingKeyOf(context).sign(claims, sessionHeader(claims))
}

/** The client's active session, if it still has a live one. */
export function activeSession(
  context: ClerkContext,
  client: ClientRecord,
): SessionJSON | undefined {
  const id = client.last_active_session_id
  const session = id === null ? undefined : context.clerk.sessions.get(id)

  return session && isLive(context, session) ? session : undefined
}
