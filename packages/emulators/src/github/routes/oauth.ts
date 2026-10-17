import type { Context } from "../../http.ts"
import { type AuthorizeParams, authorizeParams, redeemCode } from "../../oauth/pkce.ts"
import {
  completeSignIn,
  parkRequest,
  renderChooser,
  renderProblem,
} from "../../oauth/sign-in-page.ts"
import { randomToken, sameSecret } from "../../oauth/tokens.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubAppRecord } from "../entities.ts"
import type { GithubStore } from "../store.ts"

/**
 * Signing in with GitHub, for OAuth Apps and GitHub Apps: the authorization page on github.com
 * (an account chooser that also asks for consent), and the token endpoint, which answers errors
 * with HTTP 200 and an `error` field as GitHub does, in JSON when the app asks for it and
 * URL-encoded otherwise. OAuth App tokens never expire; a GitHub App with expiring user tokens
 * gets an eight-hour token and a single-use refresh token.
 */

const CHOOSE = "/login/oauth/authorize/choose"
const TROUBLESHOOTING =
  "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-authorization-request-errors"
const TOKEN_ERRORS =
  "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors"

const USER_TOKEN_SECONDS = 8 * 3600
const REFRESH_TOKEN_SECONDS = 15_897_600

/** Scopes as GitHub reports them: comma-separated, whatever separator was asked with. */
const scopeList = (scope: string) =>
  scope
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(",")

/**
 * Whether `asked` may be used as the redirect: a GitHub App needs one of its callback URLs; an
 * OAuth App's redirect may be any path under its callback URL on the same host and port.
 */
function redirectAllowed(app: GithubAppRecord, asked: string): boolean {
  if (app.kind === "github-app") return app.callbackUrls.includes(asked)

  return app.callbackUrls.some((registered) => {
    try {
      const [a, r] = [new URL(asked), new URL(registered)]

      return a.origin === r.origin && a.pathname.startsWith(r.pathname)
    } catch {
      return false
    }
  })
}

/** GitHub sends a mismatched redirect back to the registered callback URL with an error. */
function redirectMismatch(c: Context, app: GithubAppRecord, state: string | null): Response {
  const target = new URL(app.callbackUrls[0] ?? "https://github.com")

  target.searchParams.set("error", "redirect_uri_mismatch")
  target.searchParams.set(
    "error_description",
    "The redirect_uri MUST match the registered callback URL for this application.",
  )
  target.searchParams.set("error_uri", `${TROUBLESHOOTING}/#redirect-uri-mismatch`)
  if (state !== null) target.searchParams.set("state", state)

  return c.redirect(target.toString())
}

function authorizePage(c: Context, context: GithubRouteContext): Response {
  const gh = context.github()
  const query = new URL(c.req.url).searchParams
  const app = gh.apps.findOneBy("clientId", query.get("client_id") ?? "")

  if (!app) return c.html(renderProblem("Page not found", "This application does not exist."), 404)

  const params: AuthorizeParams = {
    ...authorizeParams(query, { offline: false, tenant: "" }),
    scope: scopeList(query.get("scope") ?? ""),
  }
  const redirect = params.redirect_uri || (app.callbackUrls[0] ?? "")

  if (!redirectAllowed(app, redirect)) return redirectMismatch(c, app, params.state)

  return c.html(
    renderChooser({
      title: `Authorize ${app.name}`,
      subtitle: `${app.name} by ${app.owner} wants to access your GitHub account`,
      action: CHOOSE,
      requestId: parkRequest(gh, { ...params, redirect_uri: redirect }),
      accounts: gh.accounts
        .all()
        .filter((account) => account.type === "User")
        .map((account) => ({
          id: account.login,
          name: account.name ?? account.login,
          email: `@${account.login}`,
        })),
    }),
  )
}

/** The answer to a token request, URL-encoded unless the app asked for JSON. */
function tokenAnswer(c: Context, fields: Record<string, string | number>): Response {
  if ((c.req.header("accept") ?? "").includes("json")) return c.json(fields)

  return c.body(
    new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])).toString(),
    200,
    {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    },
  )
}

function tokenError(c: Context, error: string, description: string): Response {
  return tokenAnswer(c, {
    error,
    error_description: description,
    error_uri: `${TOKEN_ERRORS}/#${error.replaceAll("_", "-")}`,
  })
}

/** Issues a user token (and, for expiring tokens, a refresh token) and answers with them. */
function issueUserToken(
  c: Context,
  context: GithubRouteContext,
  app: GithubAppRecord,
  grant: { readonly user: string; readonly scope: string },
): Response {
  const gh = context.github()
  const now = context.clock().getTime()
  const at = (seconds: number) => new Date(now + seconds * 1000).toISOString()
  const common = {
    kind: "access" as const,
    clientId: app.clientId,
    ...grant,
    revoked: false,
    parent: null,
  }

  if (!app.expiringUserTokens) {
    const token = gh.tokens.insert({ ...common, token: randomToken("gho_", 27), expiresAt: null })

    return tokenAnswer(c, { access_token: token.token, token_type: "bearer", scope: grant.scope })
  }

  const refresh = gh.tokens.insert({
    ...common,
    kind: "refresh",
    token: randomToken("ghr_", 54),
    expiresAt: at(REFRESH_TOKEN_SECONDS),
  })
  const access = gh.tokens.insert({
    ...common,
    token: randomToken("ghu_", 27),
    expiresAt: at(USER_TOKEN_SECONDS),
    parent: refresh.token,
  })

  return tokenAnswer(c, {
    access_token: access.token,
    expires_in: USER_TOKEN_SECONDS,
    refresh_token: refresh.token,
    refresh_token_expires_in: REFRESH_TOKEN_SECONDS,
    token_type: "bearer",
    scope: "",
  })
}

/** The token request's fields, from a JSON or URL-encoded body. */
async function tokenFields(c: Context): Promise<Record<string, string>> {
  const text = await c.req.text()

  if (!(c.req.header("content-type") ?? "").includes("json"))
    return Object.fromEntries(new URLSearchParams(text))

  const parsed: unknown = JSON.parse(text || "{}")

  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    : {}
}

function exchangeCode(
  c: Context,
  context: GithubRouteContext,
  app: GithubAppRecord,
  form: Record<string, string>,
) {
  const gh = context.github()
  const pending = gh.codes.findOneBy("code", form.code ?? "")
  const result = redeemCode(
    gh,
    {
      code: form.code ?? "",
      clientId: app.clientId,
      redirectUri: form.redirect_uri || (pending?.params.redirect_uri ?? ""),
      verifier: form.code_verifier,
    },
    context.clock,
  )

  if ("failure" in result)
    return result.failure === "redirect_mismatch"
      ? tokenError(
          c,
          "redirect_uri_mismatch",
          "The redirect_uri MUST match the registered callback URL for this application.",
        )
      : tokenError(c, "bad_verification_code", "The code passed is incorrect or expired.")

  return issueUserToken(c, context, app, {
    user: result.issued.user,
    scope: result.issued.params.scope,
  })
}

/** Trades a single-use refresh token for a new pair; the old pair stops working. */
function refreshToken(
  c: Context,
  context: GithubRouteContext,
  app: GithubAppRecord,
  value: string,
) {
  const gh = context.github()
  const found = gh.tokens.findOneBy("token", value)
  const live =
    found &&
    found.kind === "refresh" &&
    !found.revoked &&
    found.clientId === app.clientId &&
    (found.expiresAt === null || Date.parse(found.expiresAt) > context.clock().getTime())

  if (!found || !live)
    return tokenError(c, "bad_refresh_token", "The refresh token passed is incorrect or expired.")

  revokeFamily(gh, found.token)

  return issueUserToken(c, context, app, { user: found.user, scope: found.scope })
}

/** Revokes a refresh token and the access tokens made from it. */
function revokeFamily(gh: GithubStore, refresh: string): void {
  for (const token of gh.tokens.all())
    if (token.token === refresh || token.parent === refresh)
      gh.tokens.update(token.id, { revoked: true })
}

async function tokenEndpoint(c: Context, context: GithubRouteContext): Promise<Response> {
  const form = await tokenFields(c)
  const app = context.github().apps.findOneBy("clientId", form.client_id ?? "")

  if (!app || !sameSecret(form.client_secret ?? "", app.clientSecret))
    return tokenError(
      c,
      "incorrect_client_credentials",
      "The client_id and/or client_secret passed are incorrect.",
    )
  if (form.grant_type === "refresh_token")
    return refreshToken(c, context, app, form.refresh_token ?? "")

  return exchangeCode(c, context, app, form)
}

/** github.com's sign-in pages and token endpoint. */
export function oauthRoutes(context: GithubRouteContext): void {
  const { app } = context

  app.get("/login/oauth/authorize", (c) => authorizePage(c, context))
  app.post(CHOOSE, (c) => {
    const gh = context.github()

    return completeSignIn(c, {
      tables: gh,
      clock: context.clock,
      accept: (login) => gh.accounts.findOneBy("login", login)?.login,
      extras: () => ({}),
      denied: {
        error: "access_denied",
        error_description: "The user has denied your application access.",
        error_uri: `${TROUBLESHOOTING}/#access-denied`,
      },
    })
  })
  app.post("/login/oauth/access_token", (c) => tokenEndpoint(c, context))
}
