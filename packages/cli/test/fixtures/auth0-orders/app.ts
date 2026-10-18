/*
 * An orders app under test with "Log in" through Auth0 (openid-client, the tenant's real domain)
 * and an orders API that takes the access token as a bearer token. The API checks each token's
 * signature against the tenant's keys, fetched per request; when the keys can't be fetched it
 * refuses with 503. It knows nothing about danwo, so its calls reach the Auth0 emulator through
 * the proxy. `/audit` lists the tokens the API accepted.
 *
 * Env: PORT. AUTH0_BUG=fail-open trusts a token unverified when the keys can't be fetched.
 */
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import * as oidc from "openid-client"

import { claimsOf, keysOf, signedBy } from "./jwt.ts"

const DOMAIN = "acme.us.auth0.com"
const ISSUER = `https://${DOMAIN}/`
const API = "https://api.orders.test"
const CLIENT_ID = "orders-web"
const CLIENT_SECRET = "orders-web-secret"
const failOpen = process.env["AUTH0_BUG"] === "fail-open"
const port = Number(process.env["PORT"])
const redirectUri = `http://127.0.0.1:${port}/callback`
/** Pending logins by state: the PKCE verifier to redeem the code with. */
const pending = new Map<string, string>()
/** Signed-in sessions by id. */
const sessions = new Map<string, { readonly email: string; readonly accessToken: string }>()
/** Every bearer token the orders API accepted. */
const accepted: string[] = []
let config: oidc.Configuration | undefined

async function auth0(): Promise<oidc.Configuration> {
  config ??= await oidc.discovery(new URL(ISSUER), CLIENT_ID, CLIENT_SECRET)

  return config
}

async function login(res: ServerResponse): Promise<void> {
  const verifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()

  pending.set(state, verifier)

  const url = oidc.buildAuthorizationUrl(await auth0(), {
    redirect_uri: redirectUri,
    scope: "openid profile email read:orders",
    audience: API,
    state,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  })

  res.writeHead(302, { location: url.href }).end()
}

/** The PKCE verifier of the login `state` names, used up. */
function takeVerifier(state: string): string {
  const verifier = pending.get(state) ?? ""

  pending.delete(state)

  return verifier
}

/** The email claim of an ID token. */
function emailOf(claims: oidc.IDToken | undefined): string {
  const email = claims?.["email"]

  return typeof email === "string" ? email : ""
}

async function callback(url: URL, res: ServerResponse): Promise<void> {
  const state = url.searchParams.get("state") ?? ""

  try {
    const tokens = await oidc.authorizationCodeGrant(await auth0(), url, {
      pkceCodeVerifier: takeVerifier(state),
      expectedState: state,
    })
    const sid = randomUUID()

    sessions.set(sid, { email: emailOf(tokens.claims()), accessToken: tokens.access_token })
    res.writeHead(302, { location: "/", "set-cookie": `sid=${sid}; Path=/; HttpOnly` }).end()
  } catch (error) {
    page(res, 502, "<h1>Login failed</h1>", String(error))
  }
}

/** Whether the token's issuer, audience and expiry are this API's. */
function claimsFit(token: string): boolean {
  const claims = claimsOf(token)
  const audience = Array.isArray(claims["aud"]) ? claims["aud"] : [claims["aud"]]

  return (
    claims["iss"] === ISSUER && audience.includes(API) && Number(claims["exp"]) * 1000 > Date.now()
  )
}

/** The orders API's check of a bearer token: 200 when it trusts it, else the status it answers. */
/** The tenant's signing keys, or undefined when they can't be fetched. */
async function tenantKeys() {
  try {
    const response = await fetch(`${ISSUER}.well-known/jwks.json`)

    return response.ok ? keysOf(await response.json()) : undefined
  } catch {
    return undefined
  }
}

/** Whether the signature checks out; with no keys, only the buggy app takes the token on trust. */
function signatureHolds(keys: ReturnType<typeof keysOf> | undefined, token: string): boolean {
  return keys === undefined ? failOpen : signedBy(keys, token)
}

async function authorize(token: string): Promise<number> {
  const keys = await tenantKeys()

  if (keys === undefined && !failOpen) return 503

  return answer(token, signatureHolds(keys, token) && claimsFit(token))
}

/** The API's answer to a token it did or didn't trust; trusted ones go on the audit list. */
function answer(token: string, trusted: boolean): number {
  if (trusted) accepted.push(token)

  return trusted ? 200 : 401
}

function page(res: ServerResponse, status: number, body: string, detail = ""): void {
  res.writeHead(status, { "content-type": "text/html" })
  res.end(`<!doctype html><title>Orders</title>${body}<pre>${detail}</pre>`)
}

function sessionOf(req: IncomingMessage) {
  return sessions.get(/(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "")
}

function home(req: IncomingMessage, res: ServerResponse): void {
  const session = sessionOf(req)

  if (session)
    page(res, 200, `<h1>Signed in as ${session.email}</h1><a href="/orders">Your orders</a>`)
  else page(res, 200, `<h1>Welcome</h1><a href="/login">Log in</a>`)
}

async function orders(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = sessionOf(req)
  const status = session ? await authorize(session.accessToken) : 401

  if (status === 200) page(res, 200, "<h1>Your orders</h1><ul><li>Order #1001</li></ul>")
  else page(res, status, "<h1>Orders unavailable</h1>")
}

/** The request's bearer token, or an empty string. */
function bearerOf(req: IncomingMessage): string {
  return /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? ""
}

async function ordersApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = bearerOf(req)
  const status = token === "" ? 401 : await authorize(token)

  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(status === 200 ? { orders: [{ id: 1001 }] } : { error: "unauthorized" }))
}

/** The app's routes by path; anything else is the home page. */
const ROUTES: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => void> = {
  "/login": (_req, res) => void login(res),
  "/callback": (_req, res, url) => void callback(url, res),
  "/orders": (req, res) => void orders(req, res),
  "/api/orders": (req, res) => void ordersApi(req, res),
  "/audit": (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ accepted }))
  },
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
  const route = ROUTES[url.pathname]

  if (route) route(req, res, url)
  else home(req, res)
})

server.listen(port, "127.0.0.1", () => console.log(`listening ${port}`))
