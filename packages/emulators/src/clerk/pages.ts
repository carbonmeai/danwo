/**
 * The Account Portal's pages: sign-in with a password or an emailed code, sign-up with an emailed
 * code, written with labelled fields so locators and the agent can drive them.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)

const STYLE = `
  :root { color-scheme: light dark; --ink: #131316; --muted: #747686; --line: #e3e3e7; --paper: #fff; --brand: #6c47ff; }
  @media (prefers-color-scheme: dark) { :root { --ink: #eeeef0; --muted: #9394a1; --line: #2f3037; --paper: #131316; } }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
  main { max-width: 400px; margin: 64px auto; padding: 40px 32px; border: 1px solid var(--line); border-radius: 12px; }
  h1 { font-size: 17px; font-weight: 700; margin: 0 0 4px; text-align: center; }
  p { color: var(--muted); margin: 0 0 24px; text-align: center; }
  label { display: block; font-weight: 500; margin: 0 0 16px; }
  input { display: block; box-sizing: border-box; width: 100%; margin-top: 6px; padding: 8px 12px;
    border: 1px solid var(--line); border-radius: 6px; font: inherit; color: inherit; background: none; }
  button { width: 100%; padding: 9px; border: 0; border-radius: 6px; background: var(--brand); color: #fff;
    font: inherit; font-weight: 500; cursor: pointer; }
  [role="alert"] { color: #d0342c; text-align: center; }
  footer { margin-top: 20px; text-align: center; color: var(--muted); }
  footer a { color: var(--brand); }
`

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body>
</html>`
}

/** What every portal form carries along: where to go back to and which dev browser this is. */
export interface PortalState {
  readonly redirectUrl: string
  readonly devBrowser: string
}

function hidden(state: PortalState, extra: Readonly<Record<string, string>> = {}): string {
  const fields = { redirect_url: state.redirectUrl, __clerk_db_jwt: state.devBrowser, ...extra }

  return Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join("")
}

function alert(error: string | undefined): string {
  return error === undefined ? "" : `<p role="alert">${escape(error)}</p>`
}

function field(label: string, name: string, type: string, value = ""): string {
  const autocomplete = { email: "email", password: "current-password", text: "one-time-code" }[type]

  return `<label>${escape(label)}<input name="${escape(name)}" type="${escape(type)}" value="${escape(value)}" autocomplete="${autocomplete ?? "off"}" required></label>`
}

function query(state: PortalState): string {
  return new URLSearchParams({
    redirect_url: state.redirectUrl,
    __clerk_db_jwt: state.devBrowser,
  }).toString()
}

/** The sign-in page: email, and a password unless the instance signs in by emailed code. */
export function signInPage(
  state: PortalState,
  options: {
    readonly password: boolean
    readonly appName: string
    readonly email?: string
    readonly error?: string
  },
): string {
  const password = options.password ? field("Password", "password", "password") : ""

  return page(
    "Sign in",
    `<h1>Sign in to ${escape(options.appName)}</h1><p>Welcome back! Please sign in to continue</p>
${alert(options.error)}
<form method="post" action="/sign-in">${hidden(state)}
${field("Email address", "identifier", "email", options.email ?? "")}${password}
<button type="submit">Continue</button>
</form>
<footer>Don’t have an account? <a href="/sign-up?${escape(query(state))}">Sign up</a></footer>`,
  )
}

/** The page that asks for the code just emailed, for a sign-in or a sign-up. */
export function codePage(
  state: PortalState,
  options: {
    readonly action: string
    readonly attemptId: string
    readonly email: string
    readonly error?: string
  },
): string {
  return page(
    "Check your email",
    `<h1>Check your email</h1><p>to continue, enter the verification code sent to ${escape(options.email)}</p>
${alert(options.error)}
<form method="post" action="${escape(options.action)}">${hidden(state, { attempt: options.attemptId })}
${field("Verification code", "code", "text")}
<button type="submit">Verify</button>
</form>`,
  )
}

/** The sign-up page: email and password, then an emailed code confirms the address. */
export function signUpPage(
  state: PortalState,
  options: { readonly appName: string; readonly error?: string },
): string {
  return page(
    "Sign up",
    `<h1>Create your account</h1><p>Welcome! Please fill in the details to get started.</p>
${alert(options.error)}
<form method="post" action="/sign-up">${hidden(state)}
${field("Email address", "email_address", "email")}${field("Password", "password", "password")}
<button type="submit">Continue</button>
</form>
<footer>Already have an account? <a href="/sign-in?${escape(query(state))}">Sign in</a></footer>`,
  )
}
