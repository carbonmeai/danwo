import { createHash } from "node:crypto"

import type {
  IDToken,
  ServerMetadata,
  TokenEndpointResponse,
  UserInfoResponse,
} from "openid-client"

import type { AuthorizeParams } from "../oauth/pkce.ts"
import { ACCESS_TOKEN_SECONDS, type IssuedToken } from "../oauth/tokens.ts"
import type { GoogleUser } from "./entities.ts"
import { GOOGLE_ENDPOINTS, GOOGLE_ISSUER, includesScope } from "./helpers.ts"

/** Google's OpenID Connect discovery document. */
export function discoveryDocument(): ServerMetadata {
  return {
    issuer: GOOGLE_ISSUER,
    authorization_endpoint: GOOGLE_ENDPOINTS.authorization,
    token_endpoint: GOOGLE_ENDPOINTS.token,
    userinfo_endpoint: GOOGLE_ENDPOINTS.userinfo,
    revocation_endpoint: GOOGLE_ENDPOINTS.revocation,
    jwks_uri: GOOGLE_ENDPOINTS.jwks,
    response_types_supported: [
      "code",
      "token",
      "id_token",
      "code token",
      "code id_token",
      "token id_token",
      "code token id_token",
      "none",
    ],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email", "profile"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: [
      "aud",
      "email",
      "email_verified",
      "exp",
      "family_name",
      "given_name",
      "iat",
      "iss",
      "name",
      "picture",
      "sub",
    ],
    code_challenge_methods_supported: ["plain", "S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
  }
}

/** What userinfo returns: the profile and email claims the token's scope allows. */
export function userInfo(user: GoogleUser, scope: string): UserInfoResponse {
  return {
    sub: user.uid,
    ...(includesScope(scope, "profile") && {
      name: user.name,
      given_name: user.given_name,
      family_name: user.family_name,
      ...(user.picture !== null && { picture: user.picture }),
      locale: user.locale,
    }),
    ...(includesScope(scope, "email") && {
      email: user.email,
      email_verified: user.email_verified,
    }),
    ...(user.hd !== null && { hd: user.hd }),
  }
}

/** `at_hash`: the left half of the access token's SHA-256, base64url. */
function accessTokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url")
}

/** The claims of an ID token for `user`, issued to the request's client. */
export function idTokenClaims(
  user: GoogleUser,
  request: Pick<AuthorizeParams, "client_id" | "nonce" | "scope">,
  accessToken: string,
  now: Date,
): IDToken {
  const issuedAt = Math.floor(now.getTime() / 1000)

  return {
    ...userInfo(user, request.scope),
    iss: GOOGLE_ISSUER,
    azp: request.client_id,
    aud: request.client_id,
    at_hash: accessTokenHash(accessToken),
    iat: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_SECONDS + 1,
    ...(request.nonce !== null && { nonce: request.nonce }),
  }
}

/** The token endpoint's answer. */
export function tokenResponse(
  access: IssuedToken,
  extras: { readonly refresh_token?: string; readonly id_token?: string },
): Omit<TokenEndpointResponse, "token_type"> & { readonly token_type: "Bearer" } {
  return {
    access_token: access.token,
    expires_in: ACCESS_TOKEN_SECONDS,
    scope: access.scope,
    token_type: "Bearer",
    ...extras,
  }
}
