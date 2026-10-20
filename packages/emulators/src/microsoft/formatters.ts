import { randomBytes } from "node:crypto"

import type {
  IDToken,
  ServerMetadata,
  TokenEndpointResponse,
  UserInfoResponse,
} from "openid-client"

import type { AuthorizeParams } from "../oauth/pkce.ts"
import { ACCESS_TOKEN_SECONDS, type IssuedToken } from "../oauth/tokens.ts"
import type { MicrosoftUser } from "./entities.ts"
import { issuerFor, MICROSOFT_LOGIN, pairwiseSubject } from "./helpers.ts"

/** A tenant path's OpenID Connect configuration, with its endpoints on that path. */
export function discoveryDocument(tenant: string): ServerMetadata {
  const base = `${MICROSOFT_LOGIN}/${tenant}`

  return {
    issuer: issuerFor(tenant),
    authorization_endpoint: `${base}/oauth2/v2.0/authorize`,
    token_endpoint: `${base}/oauth2/v2.0/token`,
    end_session_endpoint: `${base}/oauth2/v2.0/logout`,
    device_authorization_endpoint: `${base}/oauth2/v2.0/devicecode`,
    jwks_uri: `${base}/discovery/v2.0/keys`,
    userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "private_key_jwt",
      "client_secret_basic",
      "self_signed_tls_client_auth",
    ],
    response_modes_supported: ["query", "fragment", "form_post"],
    response_types_supported: ["code", "id_token", "code id_token", "id_token token"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "nonce",
      "name",
      "preferred_username",
      "oid",
      "tid",
      "ver",
      "email",
    ],
    request_uri_parameter_supported: false,
    http_logout_supported: true,
    frontchannel_logout_supported: true,
    kerberos_endpoint: `${base}/kerberos`,
    mtls_endpoint_aliases: {
      token_endpoint: `https://mtlsauth.microsoft.com/${tenant}/oauth2/v2.0/token`,
    },
    tls_client_certificate_bound_access_tokens: true,
    tenant_region_scope: null,
    cloud_instance_name: "microsoftonline.com",
    cloud_graph_host_name: "graph.windows.net",
    msgraph_host: "graph.microsoft.com",
    rbac_url: "https://pas.windows.net",
  }
}

/** `client_info`: MSAL's account key, the user's object id and tenant as base64url JSON. */
export function clientInfo(user: MicrosoftUser): string {
  return Buffer.from(JSON.stringify({ uid: user.oid, utid: user.tenant_id })).toString("base64url")
}

/** The claims of a v2.0 ID token for `user`, issued to the request's client. */
export function idTokenClaims(
  user: MicrosoftUser,
  request: Pick<AuthorizeParams, "client_id" | "nonce" | "scope">,
  now: Date,
): IDToken {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const withEmail = request.scope.split(/\s+/).includes("email")

  return {
    aud: request.client_id,
    iss: `${MICROSOFT_LOGIN}/${user.tenant_id}/v2.0`,
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_SECONDS + 1,
    name: user.name,
    oid: user.oid,
    preferred_username: user.email,
    sub: pairwiseSubject(user.oid, request.client_id),
    tid: user.tenant_id,
    uti: randomBytes(16).toString("base64url"),
    ver: "2.0",
    ...(request.nonce !== null && { nonce: request.nonce }),
    ...(withEmail && { email: user.email }),
  }
}

/** The token endpoint's answer, with MSAL's `client_info` and `ext_expires_in`. */
export function tokenResponse(
  access: IssuedToken,
  extras: {
    readonly refresh_token?: string
    readonly id_token?: string
    readonly client_info: string
  },
): Omit<TokenEndpointResponse, "token_type"> & { readonly token_type: "Bearer" } {
  return {
    token_type: "Bearer",
    scope: access.scope,
    expires_in: ACCESS_TOKEN_SECONDS,
    ext_expires_in: ACCESS_TOKEN_SECONDS,
    access_token: access.token,
    ...extras,
  }
}

/** The OpenID userinfo Graph serves: the per-app subject and the profile. */
export function userInfo(user: MicrosoftUser, clientId: string): UserInfoResponse {
  return {
    sub: pairwiseSubject(user.oid, clientId),
    name: user.name,
    family_name: user.family_name,
    given_name: user.given_name,
    email: user.email,
  }
}

/** Graph's `/me`: the signed-in user's directory profile. */
export function graphUser(user: MicrosoftUser) {
  return {
    "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users/$entity",
    businessPhones: [],
    displayName: user.name,
    givenName: user.given_name,
    jobTitle: null,
    mail: user.email,
    mobilePhone: null,
    officeLocation: null,
    preferredLanguage: "en-US",
    surname: user.family_name,
    userPrincipalName: user.email,
    id: user.oid,
  }
}
