import type { App, Context, Middleware } from "../../http.ts"
import type { ClerkContext } from "../context.ts"
import { devBrowserFor, handshakeDirectives, storeNonce } from "../handshake.ts"
import { invalidParameter } from "../helpers.ts"

/** The origin a redirect URL points at, for the session token's `azp`. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * `GET /v1/client/handshake`: the redirect an app's middleware sends a browser through to learn
 * who is signed in. The emulator works out the dev browser's active session, keeps the cookie
 * directives under a nonce, and sends the browser back with `__clerk_handshake_nonce`; the app's
 * server then collects the directives from the Backend API.
 */
function handshake(c: Context, context: ClerkContext): Response {
  const redirectUrl = c.req.query("redirect_url")

  if (redirectUrl === undefined || originOf(redirectUrl) === undefined)
    throw invalidParameter("redirect_url")

  const devBrowser = devBrowserFor(context, c.req.query("__clerk_db_jwt"))
  const directives = handshakeDirectives(context, devBrowser, {
    suffixed: c.req.query("suffixed_cookies") === "true",
    azp: originOf(redirectUrl),
  })
  const back = new URL(redirectUrl)

  back.searchParams.set("__clerk_handshake_nonce", storeNonce(context, directives))

  return c.redirect(back.toString(), 307)
}

/**
 * ClerkJS calls the Frontend API from the app's own origin with credentials, so every answer names
 * that origin and preflights are answered here.
 */
export function frontendCors(): Middleware {
  return async (c, next) => {
    const origin = c.req.header("origin")

    if (origin === undefined) return next()

    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers":
        c.req.header("access-control-request-headers") ?? "content-type",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      vary: "Origin",
    }

    if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers })

    for (const [name, value] of Object.entries(headers)) c.header(name, value)

    return next()
  }
}

/**
 * ClerkJS sends `PATCH` and `DELETE` as a `POST` with `_method` in the query, so they pass
 * through anything that only allows simple requests; the request is replayed with its real method.
 */
export function methodOverride(app: App): Middleware {
  return async (c, next) => {
    const method = c.req.query("_method")

    if (c.req.method !== "POST" || method === undefined) return next()

    const url = new URL(c.req.url)

    url.searchParams.delete("_method")

    const body = method.toUpperCase() === "GET" ? null : await c.req.raw.arrayBuffer()

    return app.fetch(
      new Request(url, { method: method.toUpperCase(), headers: c.req.raw.headers, body }),
    )
  }
}

/** The Frontend API's handshake and public keys. */
export function frontendRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/client/handshake", (c) => handshake(c, context))
  app.get("/.well-known/jwks.json", (c) => c.json({ keys: [context.key.jwk] }))
}
