/**
 * Hosted authentication: the page the browser is sent to (`/v3/connect/auth`), which hands back a
 * code, and the token endpoint that turns the code into a grant's tokens, for a backend with the
 * API key as the client secret or for a browser with a PKCE verifier (as `@nylas/connect` does).
 */
import { createHash, randomBytes } from "node:crypto"

import { escapeHtml, htmlPage } from "../../html.ts"
import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import type { NylasCode, NylasGrant, NylasProvider } from "../entities.ts"
import { addGrant } from "../grants.ts"
import { type NylasRouteContext, requestId, seconds } from "../helpers.ts"

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;background:#f4f6fb;color:#1c2333;margin:0}
main{max-width:420px;margin:12vh auto;background:#fff;border:1px solid #e1e5ee;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 8px}p{color:#5a6377}label{display:block;margin:16px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cbd1dd;border-radius:8px;font:inherit}
.actions{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:10px;border-radius:8px;border:1px solid #cbd1dd;
background:#fff;font:inherit;cursor:pointer}button[value=allow]{background:#2c5bf6;color:#fff;border-color:#2c5bf6}`

const PROVIDERS: readonly NylasProvider[] = [
  "google",
  "microsoft",
  "imap",
  "icloud",
  "yahoo",
  "ews",
]
const ACCESS_SECONDS = 3600

/** An OAuth error, in the shape the SDK reads into a `NylasOAuthError`. */
function oauthError(c: Context, status: number, error: string, description: string): Response {
  return c.json(
    {
      request_id: requestId(),
      error,
      error_code: status,
      error_description: description,
      error_uri: "",
    },
    status,
  )
}

const hidden = (name: string, value: string | undefined) =>
  value === undefined ? "" : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`

/** The consent page for one sign-in request. */
function consentPage(query: Readonly<Record<string, string | undefined>>): string {
  const provider = query["provider"] ?? "google"
  const fields = [
    "client_id",
    "redirect_uri",
    "state",
    "scope",
    "code_challenge",
    "code_challenge_method",
  ]

  return htmlPage(
    "Connect your account",
    STYLE,
    `<h1>Connect your account</h1><p>The app asks to read and send your mail and manage your calendar and contacts through Nylas (${escapeHtml(provider)}).</p>
<form method="post" action="/v3/connect/auth/decide">${fields.map((f) => hidden(f, query[f])).join("")}${hidden("provider", provider)}
<label for="email">Email</label><input id="email" name="email" type="email" required value="${escapeHtml(query["login_hint"] ?? "")}">
<label for="name">Name</label><input id="name" name="name" value="">
<div class="actions"><button name="decision" value="deny">Deny</button><button name="decision" value="allow">Allow</button></div></form>`,
  )
}

/** Back to the app's redirect URI with `params`. */
function backTo(
  c: Context,
  redirectUri: string,
  params: Record<string, string | undefined>,
): Response {
  const url = new URL(redirectUri)

  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, value)

  return c.redirect(url.toString())
}

function issueCode(
  context: NylasRouteContext,
  grant: NylasGrant,
  form: Readonly<Record<string, string>>,
): string {
  const code: NylasCode = {
    id: randomBytes(24).toString("base64url"),
    grant_id: grant.id,
    client_id: form["client_id"] ?? "",
    redirect_uri: form["redirect_uri"] ?? "",
    challenge: form["code_challenge"] ?? null,
    challenge_method: form["code_challenge_method"] ?? null,
    used: false,
  }

  context.objects.codes.add(code, null)

  return code.id
}

function decide(
  context: NylasRouteContext,
  c: Context,
  form: Readonly<Record<string, string>>,
): Response {
  const redirectUri = form["redirect_uri"]

  if (!redirectUri) return c.text("redirect_uri is required", 400)
  if (form["decision"] !== "allow")
    return backTo(c, redirectUri, {
      error: "access_denied",
      error_description: "The user denied access",
      state: form["state"],
    })

  const provider = PROVIDERS.find((p) => p === form["provider"]) ?? "google"
  const { grant, created } = addGrant(context, {
    email: form["email"] ?? "",
    provider,
    ...(form["name"] && { name: form["name"] }),
    state: form["state"] ?? null,
    ...(form["scope"] && { scope: form["scope"].split(/[ ,]+/).filter(Boolean) }),
  })

  context.events.grant(created ? "grant.created" : "grant.updated", grant)

  return backTo(c, redirectUri, { code: issueCode(context, grant, form), state: form["state"] })
}

/** Tokens for `grant`: a short-lived access token, a refresh token and an id token. */
function tokensFor(context: NylasRouteContext, grant: NylasGrant, clientId: string) {
  const now = seconds(context.clock)

  const make = (kind: "access" | "refresh" | "id", lifetime: number) => {
    const id = `${kind === "access" ? "nyat" : kind === "refresh" ? "nyrt" : "nyid"}_${randomBytes(24).toString("base64url")}`

    context.objects.tokens.add({ id, grant_id: grant.id, kind, expires_at: now + lifetime }, null)

    return id
  }

  return {
    access_token: make("access", ACCESS_SECONDS),
    refresh_token: make("refresh", 365 * 86_400),
    id_token: make("id", ACCESS_SECONDS),
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    scope: grant.scope.join(" "),
    grant_id: grant.id,
    email: grant.email,
    provider: grant.provider,
    client_id: clientId,
  }
}

/** Whether the exchange proves it may have the code: the API key, or the PKCE verifier. */
function proves(
  context: NylasRouteContext,
  code: NylasCode,
  body: Readonly<Record<string, unknown>>,
): boolean {
  const secret = body["client_secret"]
  const verifier = body["code_verifier"]
  const keys = context.objects.apiKeys()

  if (
    typeof secret === "string" &&
    (keys.includes(secret) || (keys.length === 0 && secret.startsWith("nyk_")))
  )
    return true
  if (code.challenge === null || typeof verifier !== "string")
    return code.challenge === null && secret !== undefined

  const hashed =
    code.challenge_method === "plain"
      ? verifier
      : createHash("sha256").update(verifier).digest("base64url")

  return hashed === code.challenge
}

async function formOrJson(c: Context): Promise<Record<string, unknown>> {
  if ((c.req.header("content-type") ?? "").includes("json")) {
    try {
      return asRecord(await c.req.json()) ?? {}
    } catch {
      return {}
    }
  }

  return { ...(await c.req.parseBody()) }
}

function exchangeCode(
  context: NylasRouteContext,
  c: Context,
  body: Readonly<Record<string, unknown>>,
): Response {
  const code =
    typeof body["code"] === "string" ? context.objects.codes.get(body["code"]) : undefined

  if (!code || code.used)
    return oauthError(c, 400, "invalid_grant", "The code is invalid or was already used")
  if (body["redirect_uri"] !== undefined && body["redirect_uri"] !== code.redirect_uri)
    return oauthError(
      c,
      400,
      "invalid_grant",
      "redirect_uri does not match the authorization request",
    )
  if (!proves(context, code, body))
    return oauthError(
      c,
      400,
      "invalid_client",
      "client_secret or code_verifier is missing or wrong",
    )

  const grant = context.objects.grants.get(code.grant_id)

  if (!grant) return oauthError(c, 400, "invalid_grant", "The grant no longer exists")

  context.objects.codes.change(code.id, { used: true })

  return c.json(tokensFor(context, grant, code.client_id))
}

function refresh(
  context: NylasRouteContext,
  c: Context,
  body: Readonly<Record<string, unknown>>,
): Response {
  const token =
    typeof body["refresh_token"] === "string"
      ? context.objects.tokens.get(body["refresh_token"])
      : undefined
  const grant = token?.kind === "refresh" ? context.objects.grants.get(token.grant_id) : undefined

  if (!grant || grant.grant_status !== "valid")
    return oauthError(
      c,
      400,
      "invalid_grant",
      "The refresh token is invalid or the grant was revoked",
    )

  const fresh = tokensFor(
    context,
    grant,
    typeof body["client_id"] === "string" ? body["client_id"] : "",
  )

  return c.json({ ...fresh, refresh_token: token?.id })
}

/** The hosted auth page, its decision, and the token, token info and revoke endpoints. */
export function connectRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  app.get("/v3/connect/auth", (c) => {
    const names = [
      "client_id",
      "redirect_uri",
      "provider",
      "login_hint",
      "state",
      "scope",
      "code_challenge",
      "code_challenge_method",
    ]
    const query = Object.fromEntries(names.map((name) => [name, c.req.query(name)]))

    if (!query["client_id"] || !query["redirect_uri"])
      return c.text("client_id and redirect_uri are required", 400)

    return c.html(consentPage(query))
  })
  app.post("/v3/connect/auth/decide", async (c) => {
    const form = Object.fromEntries(
      Object.entries(await c.req.parseBody()).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v]] : [],
      ),
    )

    return decide(context, c, form)
  })
  app.post("/v3/connect/token", async (c) => {
    const body = await formOrJson(c)

    if (body["grant_type"] === "authorization_code") return exchangeCode(context, c, body)
    if (body["grant_type"] === "refresh_token") return refresh(context, c, body)

    return oauthError(
      c,
      400,
      "unsupported_grant_type",
      "grant_type must be authorization_code or refresh_token",
    )
  })
  app.get("/v3/connect/tokeninfo", (c) => {
    const id = c.req.query("access_token") ?? c.req.query("id_token")
    const token = id === undefined ? undefined : objects.tokens.get(id)
    const grant = token && objects.grants.get(token.grant_id)

    if (!token || !grant || token.expires_at <= seconds(context.clock))
      return oauthError(c, 401, "invalid_token", "The token is invalid or expired")

    return c.json({
      request_id: requestId(),
      data: {
        iss: "https://nylas.com",
        aud: objects.applicationId(),
        sub: grant.id,
        email: grant.email,
        iat: token.expires_at - ACCESS_SECONDS,
        exp: token.expires_at,
      },
    })
  })
  app.post("/v3/connect/revoke", (c) => {
    const token = c.req.query("token")

    if (token !== undefined) objects.tokens.remove(token)

    return c.json({ request_id: requestId(), data: { status: "success" } })
  })
}
