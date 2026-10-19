/**
 * The hosted Connect UI (`connect.nango.dev`): the page `@nangohq/frontend` opens in an iframe (or
 * the `connect_link` opens on its own), where the user picks an integration and allows it. The
 * page answers the SDK's `ready` / `session_token` handshake and posts `connect` back to the app.
 */
import { escapeHtml, htmlPage } from "../../html.ts"
import type { Context } from "../../http.ts"
import { authWebhook, connect } from "../connections.ts"
import type { NangoRouteContext } from "../helpers.ts"
import type { NangoSession } from "../store.ts"

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;background:rgba(15,18,30,.45);color:#161a26;margin:0}
main{max-width:420px;margin:10vh auto;background:#fff;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 6px}p{color:#5b6274}form{margin:0}.row{display:flex;gap:8px;margin-top:10px}
button{flex:1;padding:11px;border-radius:9px;border:1px solid #d3d8e2;background:#fff;font:inherit;cursor:pointer;text-align:left}
button.primary{background:#161a26;color:#fff;border-color:#161a26;text-align:center}`

/** Posts `message` to the app's window when the page is in an iframe or a popup. */
const toApp = (message: unknown) =>
  `<script>(window.parent!==window?window.parent:window.opener)?.postMessage(${JSON.stringify(message)},"*")</script>`

/** The live session a page names, if it is not expired. */
function sessionOf(
  context: NangoRouteContext,
  token: string | undefined,
): NangoSession | undefined {
  const session = token === undefined ? undefined : context.objects.sessions.get(token)

  return session && Date.parse(session.expires_at) > context.clock().getTime() ? session : undefined
}

/** The first page: waits for the SDK's session token, or takes it from the connect link. */
function waitingPage(): string {
  return htmlPage(
    "Connect",
    STYLE,
    `<h1>Connect</h1><p>Loading…</p>${toApp({ type: "ready" })}<script>
window.addEventListener("message",(e)=>{if(e.data&&e.data.type==="session_token")location.href="/choose?session_token="+encodeURIComponent(e.data.sessionToken)})
</script>`,
  )
}

/** The integrations a session may connect, as buttons. */
function choosePage(context: NangoRouteContext, session: NangoSession): string {
  const integrations = context.objects.integrations
    .all()
    .filter(
      (i) =>
        session.allowed_integrations === null ||
        session.allowed_integrations.includes(i.unique_key),
    )
  const buttons = integrations
    .map(
      (i) =>
        `<form method="post" action="/allow"><input type="hidden" name="session_token" value="${escapeHtml(session.id)}"><input type="hidden" name="integration" value="${escapeHtml(i.unique_key)}"><div class="row"><button name="decision" value="allow">Connect ${escapeHtml(i.display_name)}</button></div></form>`,
    )
    .join("")

  return htmlPage(
    "Connect an integration",
    STYLE,
    `<h1>${session.reconnect ? "Reconnect" : "Connect an integration"}</h1><p>Choose what to connect.</p>${buttons}
<form method="post" action="/close"><div class="row"><button class="primary" name="decision" value="close">Close</button></div></form>`,
  )
}

function allow(
  context: NangoRouteContext,
  c: Context,
  form: Readonly<Record<string, unknown>>,
): Response {
  const session = sessionOf(
    context,
    typeof form["session_token"] === "string" ? form["session_token"] : undefined,
  )
  const integration = typeof form["integration"] === "string" ? form["integration"] : ""

  if (
    !session ||
    (session.allowed_integrations && !session.allowed_integrations.includes(integration))
  )
    return c.html(htmlPage("Expired", STYLE, "<h1>This session has expired</h1>"), 400)

  const { connection, created } = connect(context, {
    integration,
    ...(session.reconnect && { connectionId: session.reconnect.connection_id }),
    endUser: session.end_user,
    tags: session.tags,
  })

  context.objects.sessions.remove(session.id)
  authWebhook(context, connection, created ? "creation" : "override", true)

  const payload = {
    connectionId: connection.connection_id,
    providerConfigKey: connection.provider_config_key,
    isPending: false,
  }

  return c.html(
    htmlPage(
      "Connected",
      STYLE,
      `<h1>Connected</h1><p>${escapeHtml(connection.provider_config_key)} is connected. You can close this window.</p>${toApp({ type: "connect", payload })}`,
    ),
  )
}

/** The Connect UI's pages, on `connect.nango.dev`. */
export function connectUiRoutes(context: NangoRouteContext): void {
  const { app } = context

  /* The API and the Connect UI share an emulator; only the UI serves these paths. */
  app.get("/", (c) => {
    const token = c.req.query("session_token")

    if (token !== undefined) return c.redirect(`/choose?session_token=${encodeURIComponent(token)}`)

    return c.html(waitingPage())
  })
  app.get("/choose", (c) => {
    const session = sessionOf(context, c.req.query("session_token"))

    if (!session)
      return c.html(htmlPage("Expired", STYLE, "<h1>This session has expired</h1>"), 400)

    return c.html(choosePage(context, session))
  })
  app.post("/allow", async (c) => allow(context, c, await c.req.parseBody()))
  app.post("/close", (c) =>
    c.html(htmlPage("Closed", STYLE, `<p>Closed.</p>${toApp({ type: "close" })}`)),
  )
}
