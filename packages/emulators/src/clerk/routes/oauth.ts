import type { App, Context } from "../../http.ts"
import { renderProblem } from "../../oauth/sign-in-page.ts"
import { BROWSER_TIMEZONE, newAttempt } from "../attempts.ts"
import { type BrowserRequest, currentClient } from "../browser-request.ts"
import { type ClerkContext, now } from "../context.ts"
import { newUser } from "../entities.ts"
import { notFound } from "../helpers.ts"
import { startSession } from "../sessions.ts"
import {
  connectionFor,
  externalAccount,
  fetchProfile,
  linkAccount,
  strategyOf,
  userForProfile,
} from "../social.ts"
import type { AttemptRecord, ClientRecord, OAuthProfile, OAuthState } from "../store.ts"

/**
 * Completes an attempt for `userId`: a new session on `client`, named by the attempt. One that
 * came back from a provider stays the client's attempt, so ClerkJS's redirect callback finds it
 * complete and makes its session active.
 */
export function completeAttempt(
  context: ClerkContext,
  client: ClientRecord,
  attempt: AttemptRecord,
  userId: string,
): AttemptRecord {
  const session = startSession(context, client, userId)

  context.clerk.clients.change(client.id, {
    last_authentication_strategy: attempt.strategy,
    ...(attempt.oauth !== null &&
      (attempt.kind === "sign_in" ? { sign_in_id: attempt.id } : { sign_up_id: attempt.id })),
  })

  return (
    context.clerk.attempts.change(attempt.id, {
      status: "complete",
      user_id: userId,
      created_session_id: session.id,
    }) ?? attempt
  )
}

/** Records how an attempt's round trip to the provider ended. */
function settleOAuth(
  context: ClerkContext,
  attempt: AttemptRecord,
  change: Pick<OAuthState, "status" | "error" | "profile">,
): AttemptRecord {
  const oauth = attempt.oauth

  if (oauth === null) return attempt

  return context.clerk.attempts.change(attempt.id, { oauth: { ...oauth, ...change } }) ?? attempt
}

/** A new user from a provider's profile: its email verified by the provider, the account linked. */
function createSocialUser(
  context: ClerkContext,
  provider: OAuthState["provider"],
  profile: OAuthProfile,
): string {
  const user = newUser(
    {
      emails: [profile.email],
      firstName: profile.first_name || null,
      lastName: profile.last_name || null,
      hasPassword: false,
      emailStrategy: `from_${strategyOf(provider)}`,
      timezone: BROWSER_TIMEZONE,
    },
    now(context),
  )
  const email = user.email_addresses[0]
  const account = externalAccount(context, provider, profile, email?.id ?? "")
  const created = context.clerk.users.add(
    { ...user, external_accounts: [account] },
    { password: null },
  )

  context.events.user("user.created", created)

  return created.id
}

/**
 * What the provider's answer does to a sign-in: an account that fits (by the provider account,
 * or by its verified email) signs in, linked to it; one that fits nobody becomes `transferable`.
 */
function finishSignIn(
  context: ClerkContext,
  client: ClientRecord,
  attempt: AttemptRecord,
  profile: OAuthProfile,
): void {
  const provider = attempt.oauth?.provider ?? "google"
  const user = userForProfile(context, provider, profile)

  if (!user) {
    settleOAuth(context, attempt, {
      status: "transferable",
      error: "external_account_not_found",
      profile,
    })

    return
  }

  const linked = linkAccount(context, user, provider, profile)
  const verified = settleOAuth(context, attempt, { status: "verified", error: null, profile })

  context.clerk.attempts.change(attempt.id, { identifier: profile.email })
  completeAttempt(context, client, verified, linked.id)
}

/**
 * What the provider's answer does to a sign-up: a new person is signed up from the profile; one
 * who already has an account makes it `transferable`, and ClerkJS signs them in instead.
 */
function finishSignUp(
  context: ClerkContext,
  client: ClientRecord,
  attempt: AttemptRecord,
  profile: OAuthProfile,
): void {
  const provider = attempt.oauth?.provider ?? "google"

  if (userForProfile(context, provider, profile)) {
    settleOAuth(context, attempt, {
      status: "transferable",
      error: "external_account_exists",
      profile,
    })

    return
  }

  const verified = settleOAuth(context, attempt, { status: "verified", error: null, profile })

  context.clerk.attempts.change(attempt.id, {
    identifier: profile.email,
    first_name: profile.first_name || null,
    last_name: profile.last_name || null,
  })
  completeAttempt(context, client, verified, createSocialUser(context, provider, profile))
}

/** The attempt a provider's `state` belongs to, if it is still waiting on the provider. */
function attemptForState(context: ClerkContext, state: string): AttemptRecord | undefined {
  return context.clerk.attempts.where(
    (a) => a.oauth !== null && a.oauth.state === state && a.oauth.status === "unverified",
  )[0]
}

/** Reads who signed in from the provider's answer, and finishes the attempt with it. */
async function finishOAuth(
  c: Context,
  context: ClerkContext,
  client: ClientRecord,
  attempt: AttemptRecord,
  oauth: OAuthState,
): Promise<void> {
  const denied = c.req.query("error") !== undefined
  const connection = connectionFor(context, strategyOf(oauth.provider))
  const profile =
    !denied && connection
      ? await fetchProfile(context, connection, c.req.query("code") ?? "", oauth.code_verifier)
      : undefined

  if (!profile)
    settleOAuth(context, attempt, {
      status: "failed",
      error: denied ? "oauth_access_denied" : "oauth_token_exchange_error",
      profile: null,
    })
  else if (attempt.kind === "sign_in") finishSignIn(context, client, attempt, profile)
  else finishSignUp(context, client, attempt, profile)
}

/** `GET /v1/oauth_callback`: the provider sends the browser back here with a code and the state. */
async function callback(c: Context, context: ClerkContext): Promise<Response> {
  const attempt = attemptForState(context, c.req.query("state") ?? "")
  const client = attempt && context.clerk.clients.get(attempt.client_id)

  if (!attempt?.oauth || !client)
    return c.html(
      renderProblem("Sign-in expired", "This sign-in has expired. Go back and try again."),
      400,
    )

  await finishOAuth(c, context, client, attempt, attempt.oauth)

  return c.redirect(attempt.oauth.redirect_url, 303)
}

/** The client's `kind` attempt, when its provider round trip came back transferable. */
function transferable(
  context: ClerkContext,
  client: ClientRecord,
  kind: AttemptRecord["kind"],
): (AttemptRecord & { oauth: OAuthState & { profile: OAuthProfile } }) | undefined {
  const id = kind === "sign_in" ? client.sign_in_id : client.sign_up_id
  const attempt = id === null ? undefined : context.clerk.attempts.get(id)
  const oauth = attempt?.oauth
  const profile = oauth?.profile

  if (!attempt || !oauth || oauth.status !== "transferable" || !profile) return undefined

  return { ...attempt, oauth: { ...oauth, profile } }
}

/** A fresh attempt of `kind` for a transfer, already holding the provider's profile. */
function transferAttempt(
  context: ClerkContext,
  request: BrowserRequest,
  kind: AttemptRecord["kind"],
  from: AttemptRecord & { oauth: OAuthState },
): AttemptRecord {
  const attempt = newAttempt(context, kind, {
    clientId: request.client.id,
    identifier: from.oauth.profile?.email ?? "",
    userId: null,
    password: null,
  })

  return (
    context.clerk.attempts.change(attempt.id, {
      strategy: from.strategy,
      oauth: { ...from.oauth, status: "verified", error: null },
    }) ?? attempt
  )
}

/**
 * `POST /v1/client/sign_ups` with `transfer`: a social sign-in that fit no user becomes a sign-up,
 * which creates the user from the provider's profile and signs them in.
 */
export function transferSignUp(context: ClerkContext, request: BrowserRequest): AttemptRecord {
  const client = currentClient(context, request)
  const from = transferable(context, client, "sign_in")

  if (!from) throw notFound("transferable sign in")

  const attempt = transferAttempt(context, request, "sign_up", from)
  const userId = createSocialUser(context, from.oauth.provider, from.oauth.profile)

  context.clerk.attempts.change(attempt.id, {
    first_name: from.oauth.profile.first_name || null,
    last_name: from.oauth.profile.last_name || null,
  })

  return completeAttempt(context, currentClient(context, request), attempt, userId)
}

/**
 * `POST /v1/client/sign_ins` with `transfer`: a social sign-up for someone who already has an
 * account becomes a sign-in to it, with the provider linked.
 */
export function transferSignIn(context: ClerkContext, request: BrowserRequest): AttemptRecord {
  const client = currentClient(context, request)
  const from = transferable(context, client, "sign_up")
  const user = from && userForProfile(context, from.oauth.provider, from.oauth.profile)

  if (!from || !user) throw notFound("transferable sign up")

  const attempt = transferAttempt(context, request, "sign_in", from)
  const linked = linkAccount(context, user, from.oauth.provider, from.oauth.profile)

  return completeAttempt(context, currentClient(context, request), attempt, linked.id)
}

/** The Frontend API's social sign-in callback. */
export function oauthRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/oauth_callback", (c) => callback(c, context))
}
