/*
 * An app under test with "Sign in with Google" through openid-client and Google's real
 * hostnames; it knows nothing about danwo, so its calls reach the Google emulator through the
 * proxy. A session exists only once Google's token endpoint answered with a valid ID token.
 */
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import * as oidc from "openid-client"

const CLIENT_ID = "123-danwo.apps.googleusercontent.com"
const CLIENT_SECRET = "GOCSPX-danwo-fixture"
const port = Number(process.env["PORT"])
const redirectUri = `http://127.0.0.1:${port}/auth/google/callback`
/** Pending sign-ins by state: the PKCE verifier to redeem the code with. */
const pending = new Map<string, string>()
/** Signed-in sessions by id: the user's email. */
const sessions = new Map<string, string | undefined>()
let config: oidc.Configuration | undefined

async function google(): Promise<oidc.Configuration> {
  config ??= await oidc.discovery(new URL("https://accounts.google.com"), CLIENT_ID, CLIENT_SECRET)

  return config
}

async function login(res: ServerResponse): Promise<void> {
  const verifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()

  pending.set(state, verifier)
  const url = oidc.buildAuthorizationUrl(await google(), {
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  })

  res.writeHead(302, { location: url.href }).end()
}

async function callback(url: URL, res: ServerResponse): Promise<void> {
  const state = url.searchParams.get("state") ?? ""
  const verifier = pending.get(state)

  pending.delete(state)

  try {
    const tokens = await oidc.authorizationCodeGrant(await google(), url, {
      ...(verifier !== undefined && { pkceCodeVerifier: verifier }),
      expectedState: state,
    })
    const sid = randomUUID()

    const email = tokens.claims()?.["email"]

    sessions.set(sid, typeof email === "string" ? email : undefined)
    res.writeHead(302, { location: "/", "set-cookie": `sid=${sid}; Path=/; HttpOnly` }).end()
  } catch (error) {
    page(res, 502, "<h1>Sign-in failed</h1>", String(error))
  }
}

function page(res: ServerResponse, status: number, body: string, detail = ""): void {
  res.writeHead(status, { "content-type": "text/html" })
  res.end(`<!doctype html><title>Fixture</title>${body}<pre>${detail}</pre>`)
}

/** The signed-in user's email for this request's session cookie, if any. */
function sessionEmail(req: IncomingMessage): string | undefined {
  return sessions.get(/(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "")
}

function home(req: IncomingMessage, res: ServerResponse): void {
  const email = sessionEmail(req)

  if (email) page(res, 200, `<h1>Signed in as ${email}</h1>`)
  else page(res, 200, `<h1>Welcome</h1><a href="/login">Sign in with Google</a>`)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)

  if (url.pathname === "/login") void login(res)
  else if (url.pathname === "/auth/google/callback") void callback(url, res)
  else if (url.pathname === "/sessions")
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ sessions: [...sessions.values()] }))
  else home(req, res)
})

server.listen(port, "127.0.0.1", () => console.log(`listening ${port}`))
