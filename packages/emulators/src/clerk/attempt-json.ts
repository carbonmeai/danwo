import { BROWSER_TIMEZONE, CODE_LIFETIME_MS, MAX_CODE_TRIES } from "./attempts.ts"
import { type ClerkContext, instanceOf } from "./context.ts"
import type { ClerkUser } from "./entities.ts"
import { authorizationUrl } from "./social.ts"
import type { AttemptRecord, OAuthState } from "./store.ts"

/** How long an unfinished attempt is kept: a day. */
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000

/** A verification's `object`: `verification_otp` for an emailed code, else named for its strategy. */
function verificationObject(strategy: string): string {
  return strategy === "email_code" ? "verification_otp" : `verification_${strategy}`
}

/** The messages Clerk gives the error codes a social round trip can end with. */
const OAUTH_ERRORS: Readonly<Record<string, string>> = {
  external_account_not_found: "The External Account was not found.",
  external_account_exists: "This account already exists. Sign in instead.",
  oauth_access_denied: "You did not grant access to your account.",
  oauth_token_exchange_error: "The provider could not confirm who you are. Try again.",
}

/** A social sign-in's verification: where to send the browser, or how it came back. */
function oauthVerification(context: ClerkContext, attempt: AttemptRecord, oauth: OAuthState) {
  const message = oauth.error === null ? "" : (OAUTH_ERRORS[oauth.error] ?? oauth.error)

  return {
    object: "verification_oauth",
    status: oauth.status,
    strategy: attempt.strategy,
    attempts: null,
    expire_at: attempt.created_at + CODE_LIFETIME_MS,
    external_verification_redirect_url: authorizationUrl(context, attempt),
    error:
      oauth.error === null ? null : { code: oauth.error, message, long_message: message, meta: {} },
  }
}

/** The verification of the factor an attempt is working on, or null before one is chosen. */
function verificationOf(context: ClerkContext, attempt: AttemptRecord) {
  if (attempt.oauth !== null) return oauthVerification(context, attempt, attempt.oauth)
  if (attempt.strategy === null) return null

  const done = attempt.status === "complete" || attempt.ticket !== null

  return {
    object: verificationObject(attempt.strategy),
    status: done ? "verified" : attempt.attempts >= MAX_CODE_TRIES ? "failed" : "unverified",
    strategy: attempt.strategy,
    attempts: attempt.attempts,
    expire_at: attempt.code_sent_at === null ? null : attempt.code_sent_at + CODE_LIFETIME_MS,
  }
}

/** The first factors a user can sign in with: their password if the instance asks for one, and an emailed code. */
function firstFactors(context: ClerkContext, user: ClerkUser | undefined) {
  if (!user) return []

  const email =
    user.email_addresses.find((e) => e.id === user.primary_email_address_id) ??
    user.email_addresses[0]
  const code = email
    ? [
        {
          strategy: "email_code",
          email_address_id: email.id,
          safe_identifier: email.email_address,
          primary: true,
        },
      ]
    : []
  const password =
    instanceOf(context).password && user.password_enabled ? [{ strategy: "password" }] : []

  return [...password, ...code]
}

/** A sign-in as ClerkJS reads it: who, how they may prove it, and how far they got. */
export function signInJson(context: ClerkContext, attempt: AttemptRecord) {
  const user = attempt.user_id === null ? undefined : context.clerk.users.get(attempt.user_id)

  const done = attempt.status === "complete"

  return {
    object: "sign_in_attempt",
    id: attempt.id,
    status: attempt.status,
    supported_identifiers: ["email_address"],
    identifier: attempt.identifier === "" ? null : attempt.identifier,
    user_data: user
      ? {
          first_name: user.first_name,
          last_name: user.last_name,
          image_url: user.image_url,
          has_image: user.has_image,
          profile_image_url: user.profile_image_url,
        }
      : null,
    supported_first_factors: done ? null : firstFactors(context, user),
    supported_second_factors: null,
    first_factor_verification: verificationOf(context, attempt),
    second_factor_verification: null,
    created_session_id: attempt.created_session_id,
    abandon_at: attempt.created_at + ABANDON_AFTER_MS,
    client_trust_state: "new",
    locale: null,
    timezone: BROWSER_TIMEZONE,
  }
}

/** The fields a sign-up must still give: an email address, and a password if the instance asks for one. */
function missingFields(context: ClerkContext, attempt: AttemptRecord): string[] {
  return [
    ...(attempt.identifier === "" ? ["email_address"] : []),
    ...(instanceOf(context).password && attempt.password === null ? ["password"] : []),
  ]
}

/** A sign-up as ClerkJS reads it: what it has, what it lacks, and the email's verification. */
export function signUpJson(context: ClerkContext, attempt: AttemptRecord) {
  const done = attempt.status === "complete"
  const verification = attempt.oauth === null ? verificationOf(context, attempt) : null
  const external = attempt.oauth === null ? null : verificationOf(context, attempt)

  return {
    object: "sign_up_attempt",
    id: attempt.id,
    status: attempt.status,
    required_fields: ["email_address", ...(instanceOf(context).password ? ["password"] : [])],
    optional_fields: ["first_name", "last_name"],
    missing_fields: missingFields(context, attempt),
    unverified_fields: done || attempt.ticket !== null ? [] : ["email_address"],
    verifications: {
      email_address: verification
        ? {
            ...verification,
            next_action: done ? "" : "needs_attempt",
            supported_strategies: ["email_code"],
          }
        : null,
      phone_number: null,
      web3_wallet: null,
      external_account: external,
    },
    username: null,
    first_name: attempt.first_name,
    last_name: attempt.last_name,
    email_address: attempt.identifier === "" ? null : attempt.identifier,
    phone_number: null,
    web3_wallet: null,
    password_enabled: attempt.password !== null,
    unsafe_metadata: {},
    public_metadata: {},
    custom_action: false,
    external_id: null,
    created_session_id: attempt.created_session_id,
    created_user_id: done ? attempt.user_id : null,
    abandon_at: attempt.created_at + ABANDON_AFTER_MS,
    legal_accepted_at: null,
    locale: null,
    timezone: BROWSER_TIMEZONE,
  }
}
