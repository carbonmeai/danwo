import type { Context } from "../../http.ts"
import { type RedeemFailure, redeemCode } from "../../oauth/pkce.ts"
import {
  clientCredentials,
  formFields,
  grantedBefore,
  issueAccessToken,
  issueRefreshToken,
  liveToken,
  sameSecret,
} from "../../oauth/tokens.ts"
import type { GoogleRouteContext } from "../context.ts"
import { idTokenClaims, tokenResponse } from "../formatters.ts"
import { googleError, grantedScope, includesScope } from "../helpers.ts"

const ACCESS_PREFIX = "ya29."
const REFRESH_PREFIX = "1//"

/** Google's answer for each way a code exchange can fail. */
const REDEEM_ERRORS: Readonly<Record<RedeemFailure, readonly [string, string]>> = {
  unknown_code: ["invalid_grant", "Malformed auth code."],
  expired_code: ["invalid_grant", "Bad Request"],
  used_code: ["invalid_grant", "Bad Request"],
  client_mismatch: ["invalid_grant", "Bad Request"],
  redirect_mismatch: ["redirect_uri_mismatch", "Bad Request"],
  missing_verifier: ["invalid_grant", "Missing code verifier."],
  verifier_mismatch: ["invalid_grant", "Invalid code verifier."],
}

/** The token endpoint: code exchange and refresh, for a client that authenticates. */
export function tokenRoutes(context: GoogleRouteContext): void {
  const { app, clock, key } = context

  /** An ID token for `uid`, when the scope asked for OpenID. */
  const idToken = (
    uid: string,
    request: { client_id: string; nonce: string | null; scope: string },
    access: string,
  ) => {
    const user = context.google().users.findOneBy("uid", uid)

    return user && includesScope(request.scope, "openid")
      ? { id_token: key.sign({ ...idTokenClaims(user, request, access, clock()) }) }
      : {}
  }

  const exchangeCode = (c: Context, form: Record<string, string>, clientId: string) => {
    const google = context.google()
    const outcome = redeemCode(
      google,
      {
        code: form.code ?? "",
        clientId,
        redirectUri: form.redirect_uri ?? "",
        verifier: form.code_verifier,
      },
      clock,
    )

    if ("failure" in outcome) {
      const [error, description] = REDEEM_ERRORS[outcome.failure]

      return googleError(c, 400, error, description)
    }

    const { params, user } = outcome.issued
    const earlier = params.incremental ? grantedBefore(google.tokens, clientId, user, clock) : []
    const scope = [...new Set([...earlier, ...grantedScope(params.scope).split(" ")])].join(" ")
    const grant = { clientId, user, scope }
    const refresh = params.offline
      ? issueRefreshToken(google.tokens, grant, REFRESH_PREFIX)
      : undefined
    const access = issueAccessToken(google.tokens, grant, {
      prefix: ACCESS_PREFIX,
      clock,
      parent: refresh?.token ?? null,
    })

    return c.json(
      tokenResponse(access, {
        ...(refresh && { refresh_token: refresh.token }),
        ...idToken(user, params, access.token),
      }),
    )
  }

  const refresh = (c: Context, form: Record<string, string>, clientId: string) => {
    const google = context.google()
    const current = liveToken(google.tokens, form.refresh_token ?? "", "refresh", clock)

    if (!current || current.clientId !== clientId)
      return googleError(c, 400, "invalid_grant", "Token has been expired or revoked.")

    const grant = { clientId, user: current.user, scope: current.scope }
    const access = issueAccessToken(google.tokens, grant, {
      prefix: ACCESS_PREFIX,
      clock,
      parent: current.token,
    })
    const request = { client_id: clientId, nonce: null, scope: current.scope }

    return c.json(tokenResponse(access, idToken(current.user, request, access.token)))
  }

  app.post("/token", async (c) => {
    const form = await formFields(c)
    const { clientId, secret } = clientCredentials(c, form)
    const client = context.google().clients.findOneBy("client_id", clientId)

    if (!client || !sameSecret(secret, client.client_secret))
      return googleError(
        c,
        401,
        "invalid_client",
        client ? "Unauthorized" : "The OAuth client was not found.",
      )
    if (form.grant_type === "authorization_code") return exchangeCode(c, form, clientId)
    if (form.grant_type === "refresh_token") return refresh(c, form, clientId)

    return googleError(
      c,
      400,
      "unsupported_grant_type",
      `Invalid grant_type: ${form.grant_type ?? ""}`,
    )
  })
}
