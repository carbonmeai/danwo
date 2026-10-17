import { createHash, timingSafeEqual } from "node:crypto"

import type { Clock, Entity, Store } from "../store.ts"
import { type IssuedToken, randomToken } from "./tokens.ts"

/** How the authorization response reaches the app. */
export type ResponseMode = "query" | "fragment" | "form_post"

/** What an authorization request asked for, kept until the user picks an account. */
export interface AuthorizeParams {
  client_id: string
  redirect_uri: string
  scope: string
  state: string | null
  nonce: string | null
  code_challenge: string | null
  code_challenge_method: "plain" | "S256" | null
  response_mode: ResponseMode
  /** Whether a refresh token was asked for (`access_type=offline`, or `offline_access`). */
  offline: boolean
  /** The tenant path the request came in on; providers without tenants leave it empty. */
  tenant: string
}

/** An authorization request waiting for the user to pick an account. */
interface PendingRequest extends Entity {
  requestId: string
  params: AuthorizeParams
}

/** A one-time authorization code and what it was issued for. */
export interface IssuedCode extends Entity {
  code: string
  params: AuthorizeParams
  /** The provider's id for the user who consented. */
  user: string
  expiresAt: string
  used: boolean
}

/** One provider's OAuth state. */
export function oauthTables(store: Store, provider: string) {
  return {
    requests: store.collection<PendingRequest>(`${provider}.requests`, ["requestId"]),
    codes: store.collection<IssuedCode>(`${provider}.codes`, ["code"]),
    tokens: store.collection<IssuedToken>(`${provider}.tokens`, ["token"]),
  }
}

export type OAuthTables = ReturnType<typeof oauthTables>

/** The authorization request's parameters as a provider-independent record. */
export function authorizeParams(
  query: URLSearchParams,
  extra: { offline: boolean; tenant: string },
): AuthorizeParams {
  const method = query.get("code_challenge_method")
  const mode = query.get("response_mode")

  return {
    client_id: query.get("client_id") ?? "",
    redirect_uri: query.get("redirect_uri") ?? "",
    scope: query.get("scope") ?? "",
    state: query.get("state"),
    nonce: query.get("nonce"),
    code_challenge: query.get("code_challenge"),
    code_challenge_method:
      method === "S256" || method === "plain"
        ? method
        : query.get("code_challenge")
          ? "plain"
          : null,
    response_mode: mode === "fragment" || mode === "form_post" ? mode : "query",
    ...extra,
  }
}

const CODE_LIFETIME_MS = 10 * 60 * 1000

/** Issues a one-time code for `user`'s consent to `params`. */
export function issueCode(
  tables: OAuthTables,
  params: AuthorizeParams,
  user: string,
  clock: Clock,
): IssuedCode {
  return tables.codes.insert({
    code: randomToken("", 32),
    params,
    user,
    expiresAt: new Date(clock().getTime() + CODE_LIFETIME_MS).toISOString(),
    used: false,
  })
}

/** Why a code could not be exchanged. */
export type RedeemFailure =
  | "unknown_code"
  | "expired_code"
  | "used_code"
  | "client_mismatch"
  | "redirect_mismatch"
  | "missing_verifier"
  | "verifier_mismatch"

export interface Redemption {
  readonly code: string
  readonly clientId: string
  readonly redirectUri: string
  readonly verifier: string | undefined
}

/** Whether `verifier` answers the request's PKCE challenge. */
function verifies(params: AuthorizeParams, verifier: string): boolean {
  const expected =
    params.code_challenge_method === "S256"
      ? createHash("sha256").update(verifier).digest("base64url")
      : verifier
  const given = Buffer.from(expected)
  const challenge = Buffer.from(params.code_challenge ?? "")

  return given.length === challenge.length && timingSafeEqual(given, challenge)
}

/** The first thing wrong with exchanging `issued` as `request` asks, if anything. */
function problemWith(
  issued: IssuedCode,
  request: Redemption,
  clock: Clock,
): RedeemFailure | undefined {
  const { params } = issued

  if (issued.used) return "used_code"
  if (Date.parse(issued.expiresAt) <= clock().getTime()) return "expired_code"
  if (params.client_id !== request.clientId) return "client_mismatch"
  if (params.redirect_uri !== request.redirectUri) return "redirect_mismatch"
  if (params.code_challenge === null) return undefined
  if (!request.verifier) return "missing_verifier"

  return verifies(params, request.verifier) ? undefined : "verifier_mismatch"
}

/**
 * Exchanges a code once. A failed exchange leaves it unused, except one that presents a used
 * code: like the real services, that is refused every time.
 */
export function redeemCode(
  tables: OAuthTables,
  request: Redemption,
  clock: Clock,
): { readonly issued: IssuedCode } | { readonly failure: RedeemFailure } {
  const issued = tables.codes.findOneBy("code", request.code)

  if (!issued) return { failure: "unknown_code" }

  const failure = problemWith(issued, request, clock)

  if (failure) return { failure }

  return { issued: tables.codes.update(issued.id, { used: true }) ?? issued }
}
