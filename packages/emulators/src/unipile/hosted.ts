/**
 * Hosted auth (`account.unipile.com/<link>`): the page a hosted link opens, where the user picks a
 * provider and signs in. Connecting makes (or reconnects) the account, notifies the link's
 * `notify_url` and sends the browser to the success URL.
 */
import { escapeHtml, htmlPage } from "../html.ts"
import type { Context } from "../http.ts"
import { accountStatus, addAccount, setStatus } from "./actions.ts"
import type { UnipileRouteContext } from "./helpers.ts"
import type { UnipileAccountType, UnipileLinkRecord } from "./store.ts"

const STYLE = `body{font:15px/1.5 system-ui,sans-serif;background:#f3f4f8;color:#141824;margin:0}
main{max-width:420px;margin:12vh auto;background:#fff;border:1px solid #e0e3eb;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 8px}label{display:block;margin:14px 0 4px;font-weight:600}
input,select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cdd1dc;border-radius:8px;font:inherit}
button{margin-top:18px;width:100%;padding:10px;border-radius:8px;border:0;background:#141824;color:#fff;font:inherit;cursor:pointer}`

const PROVIDERS: readonly { readonly type: UnipileAccountType; readonly label: string }[] = [
  { type: "LINKEDIN", label: "LinkedIn" },
  { type: "WHATSAPP", label: "WhatsApp" },
  { type: "GOOGLE_OAUTH", label: "Google" },
  { type: "MAIL", label: "Email (IMAP)" },
]

function linkOf(context: UnipileRouteContext, id: string): UnipileLinkRecord | undefined {
  const link = context.objects.links.get(id)

  return link && Date.parse(link.expires_on) > context.clock().getTime() ? link : undefined
}

/** The providers a link offers: all of them for `*`, else the ones it names. */
function offered(link: UnipileLinkRecord) {
  return PROVIDERS.filter(
    (p) =>
      link.providers.includes("*") ||
      link.providers.some((name) => p.type.startsWith(name.toUpperCase())),
  )
}

function page(link: UnipileLinkRecord): string {
  const options = offered(link)
    .map((p) => `<option value="${p.type}">${escapeHtml(p.label)}</option>`)
    .join("")

  return htmlPage(
    link.type === "reconnect" ? "Reconnect your account" : "Connect your account",
    STYLE,
    `<h1>${link.type === "reconnect" ? "Reconnect your account" : "Connect your account"}</h1>
<form method="post" action="/${escapeHtml(link.id)}/connect">
${link.type === "create" ? `<label for="provider">Provider</label><select id="provider" name="provider">${options}</select>` : ""}
<label for="name">Your name</label><input id="name" name="name" value="${escapeHtml(link.name ?? "")}">
<label for="username">Username or email</label><input id="username" name="username" required>
<button type="submit">Connect</button></form>`,
  )
}

function finish(c: Context, link: UnipileLinkRecord, accountId: string): Response {
  const target = link.success_redirect_url

  if (target === null)
    return c.html(
      htmlPage("Connected", STYLE, "<h1>Connected</h1><p>You can close this window.</p>"),
    )

  const url = new URL(target)

  url.searchParams.set("account_id", accountId)

  return c.redirect(url.toString())
}

function connect(
  context: UnipileRouteContext,
  c: Context,
  link: UnipileLinkRecord,
  form: Readonly<Record<string, unknown>>,
): Response {
  const reconnected =
    link.reconnect_account === null
      ? undefined
      : context.objects.accounts.get(link.reconnect_account)
  const account = reconnected ?? newAccount(context, form)
  const status = reconnected ? "RECONNECTED" : "CREATION_SUCCESS"

  if (reconnected) setStatus(context, reconnected, "OK")
  else accountStatus(context, account, status)

  context.objects.links.remove(link.id)
  if (link.notify_url)
    context.outbox.push(`notify:${link.notify_url}`, {
      status,
      account_id: account.id,
      name: link.name ?? account.name,
    })

  return finish(c, link, account.id)
}

/** The account the hosted page's form describes. */
function newAccount(context: UnipileRouteContext, form: Readonly<Record<string, unknown>>) {
  const text = (key: string) => (typeof form[key] === "string" ? form[key] : "")
  const type = PROVIDERS.find((p) => p.type === text("provider"))?.type ?? "LINKEDIN"

  return addAccount(context, {
    type,
    name: text("name") || text("username"),
    username: text("username"),
  })
}

const expired = (c: Context) =>
  c.html(htmlPage("Expired", STYLE, "<h1>This link has expired</h1>"), 404)

/** The hosted auth pages. */
export function hostedRoutes(context: UnipileRouteContext): void {
  const { app } = context

  app.get("/:link", (c) => {
    const link = linkOf(context, c.req.param("link"))

    return link ? c.html(page(link)) : expired(c)
  })
  app.post("/:link/connect", async (c) => {
    const link = linkOf(context, c.req.param("link"))

    return link ? connect(context, c, link, await c.req.parseBody()) : expired(c)
  })
}
