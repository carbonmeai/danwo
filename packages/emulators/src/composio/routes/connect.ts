/**
 * The browser's side of connecting: the hosted link page, the hand-off to a backend emulator's
 * consent page, and the OAuth callback that brings the user back and on to the app.
 */
import { escapeHtml, htmlPage } from "../../html.ts"
import type { Context } from "../../http.ts"
import { liveLink } from "../accounts.ts"
import { backendFor, type ConnectedBackend, type OAuthClient } from "../backends/index.ts"
import {
  completeConnection,
  connectsOnBackend,
  emulatedCredentials,
  failConnection,
} from "../connections.ts"
import type { ComposioRouteContext } from "../context.ts"
import type { AuthConfigRecord, ConnectedAccountRecord, LinkRecord } from "../entities.ts"
import { api } from "../helpers.ts"
import { toolkitName } from "../lookup.ts"

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1d2433;margin:0}
main{max-width:420px;margin:12vh auto;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 8px}p{color:#5b6475}label{display:block;margin:16px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cdd2db;border-radius:8px;font:inherit}
.actions{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:10px;border-radius:8px;border:1px solid #cdd2db;
background:#fff;font:inherit;cursor:pointer}button[value=allow]{background:#1d2433;color:#fff;border-color:#1d2433}`

type Parts = {
  readonly link: LinkRecord
  readonly account: ConnectedAccountRecord
  readonly config: AuthConfigRecord
}

/** The link, its account and auth config, or undefined when the link is unknown or used up. */
function partsOf(context: ComposioRouteContext, id: string): Parts | undefined {
  const link = liveLink(context, id)
  const account = link && context.objects.accounts.get(link.accountId)
  const config = account && context.objects.authConfigs.get(account.authConfigId)

  return link && account && config && account.status === "INITIATED"
    ? { link, account, config }
    : undefined
}

function gone(c: Context): Response {
  return c.html(
    htmlPage(
      "Link expired",
      STYLE,
      "<h1>This link has expired</h1><p>Ask the app for a new one.</p>",
    ),
    404,
  )
}

/** Back to the app's callback URL with the outcome, or a page saying how it went when there is none. */
function finish(
  c: Context,
  link: LinkRecord,
  account: ConnectedAccountRecord,
  error?: string,
): Response {
  if (link.callbackUrl === null) {
    const title = error === undefined ? "Connected" : "Not connected"

    return c.html(htmlPage(title, STYLE, `<h1>${title}</h1><p>You can close this window.</p>`))
  }

  const target = new URL(link.callbackUrl)

  target.searchParams.set("status", error === undefined ? "success" : "failed")
  target.searchParams.set("connected_account_id", account.id)
  target.searchParams.set("appName", account.toolkit)
  if (error !== undefined) target.searchParams.set("error", error)

  return c.redirect(target.toString())
}

/** The OAuth app the backend knows the connection by: the auth config's own, or Composio's. */
function clientOf(config: AuthConfigRecord, connected: ConnectedBackend): OAuthClient {
  const id = config.credentials["client_id"]
  const secret = config.credentials["client_secret"]

  if (typeof id === "string" && typeof secret === "string")
    return { client_id: id, client_secret: secret }

  connected.backend.register(connected.emulator, connected.backend.managedClient)

  return connected.backend.managedClient
}

function connectPage(context: ComposioRouteContext, c: Context, parts: Parts): Response {
  const connected =
    connectsOnBackend(context, parts.config) && backendFor(context.store, parts.config.toolkit)

  if (connected)
    return c.redirect(
      connected.backend.authorizeUrl(
        clientOf(parts.config, connected),
        parts.config.scopes,
        parts.link.id,
      ),
    )

  const name = escapeHtml(toolkitName(context.objects, parts.config.toolkit))
  const field =
    parts.config.authScheme === "API_KEY" || parts.config.authScheme === "BEARER_TOKEN"
      ? `<label for="api_key">API key</label><input id="api_key" name="api_key" required>`
      : `<label for="account">Account</label><input id="account" name="account" value="${escapeHtml(parts.account.userId)}">`

  return c.html(
    htmlPage(
      `Connect ${name}`,
      STYLE,
      `<h1>Connect ${name}</h1><p>Allow the app to act on your ${name} account.</p>
<form method="post">${field}<div class="actions">
<button type="submit" name="decision" value="deny">Cancel</button>
<button type="submit" name="decision" value="allow">Connect</button></div></form>`,
    ),
  )
}

async function decide(context: ComposioRouteContext, c: Context, parts: Parts): Promise<Response> {
  const form = await c.req.parseBody()

  if (form["decision"] !== "allow") {
    failConnection(context, parts.account, "The user cancelled the connection")

    return finish(c, parts.link, parts.account, "access_denied")
  }

  const apiKey = typeof form["api_key"] === "string" ? form["api_key"] : undefined
  const label =
    typeof form["account"] === "string" && form["account"] !== ""
      ? form["account"]
      : parts.account.userId
  const val = apiKey === undefined ? emulatedCredentials() : { api_key: apiKey }

  completeConnection(context, parts.account, val, label)
  context.objects.links.remove(parts.link.id)

  return finish(c, parts.link, parts.account)
}

/** The provider sent the user back: exchange the code on the backend and finish the connection. */
async function callback(context: ComposioRouteContext, c: Context): Promise<Response> {
  const parts = partsOf(context, c.req.query("state") ?? "")

  if (!parts) return gone(c)

  const connected = backendFor(context.store, parts.config.toolkit)
  const code = c.req.query("code")
  const denied = c.req.query("error")

  if (!connected || code === undefined || denied !== undefined) {
    failConnection(context, parts.account, denied ?? "The provider sent no code")

    return finish(c, parts.link, parts.account, denied ?? "no_code")
  }

  const send = (request: Request) => connected.emulator.fetch(request)

  try {
    const tokens = await connected.backend.exchange(send, clientOf(parts.config, connected), code)

    completeConnection(
      context,
      parts.account,
      { ...tokens },
      await connected.backend.whoami(send, tokens.access_token),
    )
  } catch (error) {
    failConnection(context, parts.account, error instanceof Error ? error.message : String(error))

    return finish(c, parts.link, parts.account, "token_exchange_failed")
  }

  context.objects.links.remove(parts.link.id)

  return finish(c, parts.link, parts.account)
}

/** Hosted connect links and the OAuth callback. */
export function connectRoutes(context: ComposioRouteContext): void {
  const { app } = context

  app.get("/link/:id", (c) => {
    const parts = partsOf(context, c.req.param("id"))

    return parts ? connectPage(context, c, parts) : gone(c)
  })
  app.post("/link/:id", (c) => {
    const parts = partsOf(context, c.req.param("id"))

    return parts ? decide(context, c, parts) : gone(c)
  })
  api(app).get("/toolkits/auth/callback", (c) => callback(context, c))
}
