import type { Context } from "../http.ts"
import type { ClerkContext } from "./context.ts"
import { browserClient } from "./frontend-json.ts"
import { ClerkFailure } from "./helpers.ts"
import type { ClientRecord, DevBrowser } from "./store.ts"

/** What a Frontend API request from ClerkJS carries: its dev browser, client and app origin. */
export interface BrowserRequest {
  readonly devBrowser: DevBrowser
  readonly client: ClientRecord
  /** The app's origin, the `azp` of the tokens minted for it. */
  readonly azp: string | undefined
}

/**
 * The dev browser and client a ClerkJS request names with `__clerk_db_jwt`. Without a known one
 * the Frontend API answers 401 `dev_browser_unauthenticated`, which makes ClerkJS create a new
 * dev browser and retry.
 */
export function browserRequest(c: Context, context: ClerkContext): BrowserRequest {
  const token =
    c.req.query("__clerk_db_jwt") ?? c.req.header("authorization")?.replace(/^Bearer /, "")
  const devBrowser = token === undefined ? undefined : context.clerk.devBrowsers.get(token)
  const client = devBrowser && context.clerk.clients.get(devBrowser.client_id)

  if (!devBrowser || !client)
    throw new ClerkFailure(
      401,
      "dev_browser_unauthenticated",
      "Browser unauthenticated",
      "Unable to authenticate the development browser.",
    )

  return { devBrowser, client, azp: c.req.header("origin") }
}

/** The client as it stands now; handlers change it, so it is read again before answering. */
export function currentClient(context: ClerkContext, request: BrowserRequest): ClientRecord {
  return context.clerk.clients.get(request.client.id) ?? request.client
}

/** The Frontend API's answer: the resource asked about, and the client it changed. */
export function reply(
  c: Context,
  context: ClerkContext,
  request: BrowserRequest,
  response: unknown,
): Response {
  return c.json({
    response,
    client: browserClient(context, currentClient(context, request), request.azp),
  })
}

/** A form error on one field, as ClerkJS shows it under that field. */
export function formError(
  code: string,
  param: string,
  message: string,
  longMessage = message,
): ClerkFailure {
  return new ClerkFailure(422, code, message, longMessage, { param_name: param })
}
