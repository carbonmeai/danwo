import type { Context } from "../http.ts"
import type { Clock } from "../store.ts"
import { type AuthorizeParams, issueCode, type OAuthTables } from "./pkce.ts"
import { randomToken } from "./tokens.ts"

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)

const STYLE = `
  :root { color-scheme: light dark; --ink: #202124; --muted: #5f6368; --line: #dadce0; --paper: #fff; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8eaed; --muted: #9aa0a6; --line: #3c4043; --paper: #202124; } }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
  main { max-width: 420px; margin: 56px auto; padding: 32px; border: 1px solid var(--line); border-radius: 8px; }
  h1 { font-size: 22px; font-weight: 500; margin: 0 0 6px; }
  p { color: var(--muted); margin: 0 0 20px; }
  ul { list-style: none; margin: 0 0 16px; padding: 0; }
  li button { display: block; width: 100%; text-align: left; padding: 12px; margin: 0; background: none;
    border: 0; border-top: 1px solid var(--line); color: inherit; font: inherit; cursor: pointer; }
  li button span { display: block; color: var(--muted); font-size: 13px; }
  .cancel { background: none; border: 0; color: var(--muted); font: inherit; cursor: pointer; padding: 8px 0; }
`

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body>
</html>`
}

/** An account the chooser offers. */
export interface ChooserAccount {
  readonly id: string
  readonly name: string
  readonly email: string
}

export interface Chooser {
  readonly title: string
  readonly subtitle: string
  /** Where the choice is posted. */
  readonly action: string
  readonly requestId: string
  readonly accounts: readonly ChooserAccount[]
}

/** The account chooser: one button per account, named "Continue as <name>", and Cancel. */
export function renderChooser(view: Chooser): string {
  const accounts = view.accounts
    .map(
      (account) =>
        `<li><button type="submit" name="user" value="${escape(account.id)}" aria-label="Continue as ${escape(account.name)}">${escape(account.name)}<span>${escape(account.email)}</span></button></li>`,
    )
    .join("")
  const list = accounts
    ? `<ul aria-label="Accounts">${accounts}</ul>`
    : "<p>No accounts are set up for this sign-in.</p>"

  return page(
    view.title,
    `<h1>${escape(view.title)}</h1><p>${escape(view.subtitle)}</p>
<form method="post" action="${escape(view.action)}">
<input type="hidden" name="request" value="${escape(view.requestId)}">
${list}
<button class="cancel" type="submit" name="deny" value="1">Cancel</button>
</form>`,
  )
}

/** A page that stops the sign-in, as the real services show for a misconfigured request. */
export function renderProblem(title: string, message: string): string {
  return page(title, `<h1>${escape(title)}</h1><p>${escape(message)}</p>`)
}

/** Sends the browser back to the app with `fields`, the way the request's response mode asks. */
export function redirectToApp(
  c: Context,
  params: Pick<AuthorizeParams, "redirect_uri" | "response_mode">,
  fields: Record<string, string>,
): Response {
  if (params.response_mode === "form_post") {
    const inputs = Object.entries(fields)
      .map(
        ([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`,
      )
      .join("")

    return c.html(
      `<!doctype html><body onload="document.forms[0].submit()"><form method="post" action="${escape(params.redirect_uri)}">${inputs}</form></body>`,
    )
  }

  const target = new URL(params.redirect_uri)
  const encoded = new URLSearchParams(fields)

  if (params.response_mode === "fragment") target.hash = encoded.toString()
  else for (const [name, value] of encoded) target.searchParams.set(name, value)

  return c.redirect(target.toString(), 302)
}

/** Parks an authorization request until the user picks an account; returns its id. */
export function parkRequest(tables: OAuthTables, params: AuthorizeParams): string {
  const requestId = randomToken("req_", 18)

  tables.requests.insert({ requestId, params })

  return requestId
}

/** How a provider finishes a sign-in once the user chose. */
export interface Completion {
  readonly tables: OAuthTables
  readonly clock: Clock
  /** The provider's id for the posted account, if it may sign in to this request. */
  readonly accept: (posted: string, params: AuthorizeParams) => string | undefined
  /** Extra fields the provider adds to a successful redirect. */
  readonly extras: (params: AuthorizeParams, user: string) => Record<string, string>
  /** What the provider redirects with when the user cancels. */
  readonly denied: Record<string, string>
}

const withState = (params: AuthorizeParams, fields: Record<string, string>) =>
  params.state === null ? fields : { ...fields, state: params.state }

/** Handles the chooser's form: a chosen account gets a code, Cancel gets `access_denied`. */
export async function completeSignIn(c: Context, completion: Completion): Promise<Response> {
  const form = new URLSearchParams(await c.req.text())
  const pending = completion.tables.requests.findOneBy("requestId", form.get("request") ?? "")

  if (!pending)
    return c.html(renderProblem("Sign-in expired", "Start the sign-in again from the app."), 400)

  const { params } = pending

  completion.tables.requests.delete(pending.id)
  if (form.has("deny")) return redirectToApp(c, params, withState(params, completion.denied))

  const user = completion.accept(form.get("user") ?? "", params)

  if (!user)
    return c.html(renderProblem("Account unavailable", "That account cannot sign in here."), 400)

  const issued = issueCode(completion.tables, params, user, completion.clock)

  return redirectToApp(
    c,
    params,
    withState(params, { code: issued.code, ...completion.extras(params, user) }),
  )
}
