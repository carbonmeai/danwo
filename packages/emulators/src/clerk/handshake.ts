import { type ClerkContext, instanceOf } from "./context.ts"
import { clerkId, cookieSuffix, secretToken } from "./helpers.ts"
import { activeSession, newClient, sessionToken } from "./sessions.ts"
import type { ClientRecord, DevBrowser } from "./store.ts"

/** Ten years, the lifetime Clerk gives the cookies a handshake sets on the app's domain. */
const COOKIE_MAX_AGE = 315_360_000

/** The dev browser a token names, or a new one with its own client. */
export function devBrowserFor(context: ClerkContext, token: string | undefined): DevBrowser {
  const known = token === undefined ? undefined : context.clerk.devBrowsers.get(token)

  if (known) return known

  return context.clerk.devBrowsers.add(
    { id: `dvb_${secretToken(24)}`, client_id: newClient(context).id },
    null,
  )
}

/** The client behind a dev browser. */
export function clientOf(context: ClerkContext, devBrowser: DevBrowser): ClientRecord {
  return context.clerk.clients.get(devBrowser.client_id) ?? newClient(context)
}

/** One `Set-Cookie` directive for the app's own domain. */
function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}`
}

/** The directive for `name`, plus its suffixed twin when the app's SDK reads suffixed cookies. */
function both(name: string, value: string, maxAge: number, suffix: string | null): string[] {
  return [
    cookie(name, value, maxAge),
    ...(suffix === null ? [] : [cookie(`${name}_${suffix}`, value, maxAge)]),
  ]
}

/** The cookie directives that sign the app in as the client's active session, or out. */
export function handshakeDirectives(
  context: ClerkContext,
  devBrowser: DevBrowser,
  options: { readonly suffixed: boolean; readonly azp: string | undefined },
): string[] {
  const suffix = options.suffixed ? cookieSuffix(instanceOf(context).publishableKey) : null
  const session = activeSession(context, clientOf(context, devBrowser))
  const browser = both("__clerk_db_jwt", devBrowser.id, COOKIE_MAX_AGE, suffix)

  if (!session)
    return [
      ...browser,
      ...both("__session", "", 0, suffix),
      ...both("__client_uat", "0", COOKIE_MAX_AGE, suffix),
    ]

  const uat = String(Math.floor(context.wallClock().getTime() / 1000) - 1)

  return [
    ...browser,
    ...both("__session", sessionToken(context, session, options.azp), COOKIE_MAX_AGE, suffix),
    ...both("__client_uat", uat, COOKIE_MAX_AGE, suffix),
  ]
}

/** Keeps a handshake's directives under a fresh nonce for the app's server to collect. */
export function storeNonce(context: ClerkContext, directives: readonly string[]): string {
  return context.clerk.nonces.add({ id: clerkId("hsn"), directives }, null).id
}
