/**
 * Social sign-in: a Clerk instance's "Continue with Google". ClerkJS starts a sign-in (or a sign-up)
 * with an `oauth_google` strategy; the Frontend API answers with the provider's authorization URL,
 * and the browser goes there. The provider sends it back to `/v1/oauth_callback` on the Frontend
 * API, which exchanges the code and reads the profile through the upstream the runner connects
 * (the Google emulator), then signs the person in, links Google to the account with that email,
 * or marks the attempt `transferable` so ClerkJS turns it into a sign-up.
 */
import { createHash } from "node:crypto"

import { upstreamProfile } from "../oauth/upstream-profile.ts"
import type { Store } from "../store.ts"
import { type ClerkContext, instanceOf, now } from "./context.ts"
import type { ClerkExternalAccount, ClerkUser } from "./entities.ts"
import { clerkId, secretToken } from "./helpers.ts"
import { SOCIAL, type AttemptRecord, type OAuthProfile } from "./store.ts"
import { upstreamOf } from "./upstream.ts"
import type { ClerkSocialProvider } from "./views.ts"

/** A social connection the instance offers, with the OAuth client it uses at the provider. */
export interface SocialConnection {
  readonly provider: SocialProvider
  readonly clientId: string
  readonly clientSecret: string
}

/** The providers the emulator can sign in with. */
export type SocialProvider = ClerkSocialProvider

/** Where a provider sends the browser, and where the instance reads who signed in. */
interface ProviderEndpoints {
  readonly name: string
  readonly authorize: string
  readonly token: string
  readonly profile: string
  readonly scope: string
}

const PROVIDERS: Readonly<Record<SocialProvider, ProviderEndpoints>> = {
  google: {
    name: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    profile: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
}

/** The strategy ClerkJS names a provider by: `oauth_google`. */
export function strategyOf(provider: SocialProvider): string {
  return `oauth_${provider}`
}

/** The instance's social connections. */
function socialConnections(store: Store): readonly SocialConnection[] {
  return store.getData(SOCIAL) ?? []
}

/** The connection a strategy such as `oauth_google` names, if the instance offers it. */
export function connectionFor(
  context: ClerkContext,
  strategy: string | undefined,
): SocialConnection | undefined {
  return socialConnections(context.store).find((c) => strategyOf(c.provider) === strategy)
}

/** The `user_settings.social` of the instance's environment: one entry per connection. */
export function socialSettings(store: Store): Record<string, unknown> {
  return Object.fromEntries(
    socialConnections(store).map((connection) => {
      const strategy = strategyOf(connection.provider)

      return [
        strategy,
        {
          enabled: true,
          required: false,
          authenticatable: true,
          block_email_subaddresses: false,
          strategy,
          not_selectable: false,
          deprecated: false,
          name: PROVIDERS[connection.provider].name,
          logo_url: null,
        },
      ]
    }),
  )
}

/** The Frontend API's callback, where providers send the browser back. */
function callbackUrl(context: ClerkContext): string {
  return `https://${instanceOf(context).frontendApi}/v1/oauth_callback`
}

/** A body field's string, or null. */
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** Starts a social sign-in or sign-up on `attempt`: the state the provider will send back. */
export function startOAuth(
  context: ClerkContext,
  attempt: AttemptRecord,
  connection: SocialConnection,
  body: Record<string, unknown>,
): AttemptRecord {
  return (
    context.clerk.attempts.change(attempt.id, {
      strategy: strategyOf(connection.provider),
      oauth: {
        provider: connection.provider,
        state: secretToken(),
        code_verifier: secretToken(32),
        redirect_url: text(body.redirect_url) ?? `https://${instanceOf(context).accountsHost}`,
        action_complete_redirect_url: text(body.action_complete_redirect_url),
        status: "unverified",
        error: null,
        profile: null,
      },
    }) ?? attempt
  )
}

/** The provider's authorization URL for an attempt waiting on it. */
export function authorizationUrl(context: ClerkContext, attempt: AttemptRecord): string | null {
  const oauth = attempt.oauth
  const connection = oauth && connectionFor(context, strategyOf(oauth.provider))

  if (!oauth || !connection || oauth.status !== "unverified") return null

  const url = new URL(PROVIDERS[oauth.provider].authorize)

  url.search = new URLSearchParams({
    client_id: connection.clientId,
    redirect_uri: callbackUrl(context),
    response_type: "code",
    scope: PROVIDERS[oauth.provider].scope,
    state: oauth.state,
    code_challenge: createHash("sha256").update(oauth.code_verifier).digest("base64url"),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account",
  }).toString()

  return url.toString()
}

/** A JSON object's string field, or "". */
function field(record: Record<string, unknown>, name: string): string {
  const value = record[name]

  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

/** Exchanges the provider's code, then reads who signed in there; undefined when refused. */
export async function fetchProfile(
  context: ClerkContext,
  connection: SocialConnection,
  code: string,
  verifier: string,
): Promise<OAuthProfile | undefined> {
  const upstream = upstreamOf(context.store)
  const provider = PROVIDERS[connection.provider]

  if (!upstream) return undefined

  const profile =
    (await upstreamProfile(upstream, provider, {
      code,
      redirect_uri: callbackUrl(context),
      client_id: connection.clientId,
      client_secret: connection.clientSecret,
      code_verifier: verifier,
    })) ?? {}
  const id = field(profile, "sub")

  if (id === "" || field(profile, "email") === "") return undefined

  return {
    provider_user_id: id,
    email: field(profile, "email").toLowerCase(),
    first_name: field(profile, "given_name"),
    last_name: field(profile, "family_name"),
    image_url: field(profile, "picture"),
    scopes: provider.scope,
  }
}

/** An external account for `profile`, verified by the provider, tied to the email `emailId`. */
export function externalAccount(
  context: ClerkContext,
  provider: SocialProvider,
  profile: OAuthProfile,
  emailId: string,
): ClerkExternalAccount {
  const strategy = strategyOf(provider)
  const at = now(context)

  return {
    object: "external_account",
    id: clerkId("idn"),
    external_account_id: clerkId("eac"),
    provider: strategy,
    identification_id: emailId,
    provider_user_id: profile.provider_user_id,
    approved_scopes: profile.scopes,
    email_address: profile.email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    image_url: profile.image_url,
    username: null,
    phone_number: null,
    public_metadata: {},
    label: null,
    verification: {
      object: "verification_oauth",
      status: "verified",
      strategy,
      attempts: null,
      expire_at: at + 10 * 60 * 1000,
    },
  }
}

/** The user who signed in with this provider account before, or who has its verified email. */
export function userForProfile(
  context: ClerkContext,
  provider: SocialProvider,
  profile: OAuthProfile,
): ClerkUser | undefined {
  const strategy = strategyOf(provider)
  const users = context.clerk.users.all()

  return (
    users.find((user) =>
      user.external_accounts.some(
        (account) =>
          account.provider === strategy && account.provider_user_id === profile.provider_user_id,
      ),
    ) ??
    users.find((user) =>
      user.email_addresses.some((email) => email.email_address.toLowerCase() === profile.email),
    )
  )
}

/** Links a provider account to `user`, unless it already is; the user as it stands after. */
export function linkAccount(
  context: ClerkContext,
  user: ClerkUser,
  provider: SocialProvider,
  profile: OAuthProfile,
): ClerkUser {
  const strategy = strategyOf(provider)

  if (user.external_accounts.some((account) => account.provider === strategy)) return user

  const email =
    user.email_addresses.find((e) => e.email_address.toLowerCase() === profile.email) ??
    user.email_addresses[0]
  const account = externalAccount(context, provider, profile, email?.id ?? "")
  const linked =
    context.clerk.users.change(user.id, {
      external_accounts: [...user.external_accounts, account],
      updated_at: now(context),
    }) ?? user

  context.events.user("user.updated", linked)

  return linked
}
