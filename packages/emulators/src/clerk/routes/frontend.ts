import type { App, Context } from "../../http.ts"
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

/** The Frontend API's handshake and public keys. */
export function frontendRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/client/handshake", (c) => handshake(c, context))
  app.get("/.well-known/jwks.json", (c) => c.json({ keys: [context.key.jwk] }))
}
