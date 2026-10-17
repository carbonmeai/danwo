import type { Context } from "../../http.ts"
import { type RedeemFailure, redeemCode } from "../../oauth/pkce.ts"
import {
  clientCredentials,
  formFields,
  issueAccessToken,
  issueRefreshToken,
  liveToken,
  sameSecret,
} from "../../oauth/tokens.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { clientInfo, idTokenClaims, tokenResponse } from "../formatters.ts"
import { type AadFailure, aadError } from "../helpers.ts"

const ACCESS_PREFIX = "EwA"
const REFRESH_PREFIX = "1.A"

const grantFailure = (code: number, message: string): AadFailure => ({
  status: 400,
  error: "invalid_grant",
  code,
  message,
})

/** The AADSTS failure for each way a code exchange can go wrong. */
const REDEEM_FAILURES: Readonly<Record<RedeemFailure, AadFailure>> = {
  unknown_code: grantFailure(9002313, "Invalid request. Request is malformed or invalid."),
  expired_code: grantFailure(
    70008,
    "The provided authorization code or refresh token has expired due to inactivity.",
  ),
  used_code: grantFailure(
    54005,
    "OAuth2 Authorization code was already redeemed, please retry with a new valid code or use an existing refresh token.",
  ),
  client_mismatch: grantFailure(
    70000,
    "The provided value for the 'code' parameter is not valid. The code was issued to a different client.",
  ),
  redirect_mismatch: grantFailure(
    50011,
    "The redirect URI specified in the request does not match the redirect URI used to obtain the authorization code.",
  ),
  missing_verifier: grantFailure(
    50148,
    "The code_verifier does not match the code_challenge supplied in the authorization request for PKCE.",
  ),
  verifier_mismatch: grantFailure(
    501481,
    "The Code_Verifier does not match the code_challenge supplied in the authorization request.",
  ),
}

/** A refresh token the user's sessions were revoked from. */
const REVOKED_GRANT = grantFailure(
  50173,
  "The provided grant has expired due to it being revoked, a fresh auth token is needed. The user might have changed or reset their password.",
)

/** The scope a token is granted: what was asked for, without the sign-in-only scopes. */
function resourceScope(requested: string): string {
  return requested
    .split(/\s+/)
    .filter((scope) => scope !== "" && scope !== "offline_access")
    .join(" ")
}

/** The v2.0 token endpoint: code exchange and refresh, for an app that authenticates. */
export function tokenRoutes(context: MicrosoftRouteContext): void {
  const { app, clock, key } = context

  /** Tokens for `oid`: access, a refresh token when allowed, and the ID token and client info. */
  const issue = (
    c: Context,
    oid: string,
    request: { client_id: string; nonce: string | null; scope: string },
    offline: boolean,
  ) => {
    const microsoft = context.microsoft()
    const user = microsoft.users.findOneBy("oid", oid)

    if (!user)
      return aadError(
        c,
        clock,
        grantFailure(50034, "The user account does not exist in the directory."),
      )

    const grant = { clientId: request.client_id, user: oid, scope: resourceScope(request.scope) }
    const refresh = offline ? issueRefreshToken(microsoft.tokens, grant, REFRESH_PREFIX) : undefined
    const access = issueAccessToken(microsoft.tokens, grant, {
      prefix: ACCESS_PREFIX,
      clock,
      parent: refresh?.token ?? null,
    })

    return c.json(
      tokenResponse(access, {
        ...(refresh && { refresh_token: refresh.token }),
        id_token: key.sign({ ...idTokenClaims(user, request, clock()) }),
        client_info: clientInfo(user),
      }),
    )
  }

  const exchangeCode = (c: Context, form: Record<string, string>, clientId: string) => {
    const outcome = redeemCode(
      context.microsoft(),
      {
        code: form.code ?? "",
        clientId,
        redirectUri: form.redirect_uri ?? "",
        verifier: form.code_verifier,
      },
      clock,
    )

    if ("failure" in outcome) return aadError(c, clock, REDEEM_FAILURES[outcome.failure])

    const { params, user } = outcome.issued

    return issue(c, user, params, params.offline)
  }

  const refresh = (c: Context, form: Record<string, string>, clientId: string) => {
    const tokens = context.microsoft().tokens
    const current = liveToken(tokens, form.refresh_token ?? "", "refresh", clock)

    if (tokens.findOneBy("token", form.refresh_token ?? "")?.revoked)
      return aadError(c, clock, REVOKED_GRANT)
    if (!current || current.clientId !== clientId)
      return aadError(c, clock, REDEEM_FAILURES.expired_code)

    return issue(
      c,
      current.user,
      { client_id: clientId, nonce: null, scope: form.scope ?? current.scope },
      true,
    )
  }

  app.post("/:tenant/oauth2/v2.0/token", async (c) => {
    const form = await formFields(c)
    const { clientId, secret } = clientCredentials(c, form)
    const client = context.microsoft().clients.findOneBy("client_id", clientId)

    if (!client)
      return aadError(c, clock, {
        status: 400,
        error: "unauthorized_client",
        code: 700016,
        message: `Application with identifier '${clientId}' was not found in the directory.`,
      })
    if (!sameSecret(secret, client.client_secret))
      return aadError(c, clock, {
        status: 401,
        error: "invalid_client",
        code: 7000215,
        message:
          "Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app.",
      })
    if (form.grant_type === "authorization_code") return exchangeCode(c, form, clientId)
    if (form.grant_type === "refresh_token") return refresh(c, form, clientId)

    return aadError(c, clock, {
      status: 400,
      error: "unsupported_grant_type",
      code: 70003,
      message: "The app requested an unsupported grant type.",
    })
  })
}
