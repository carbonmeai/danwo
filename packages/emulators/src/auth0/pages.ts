/**
 * The Universal Login pages a browser (or a test's locators, or the agent) goes through: log in,
 * sign up, the one-time-code step, and the error page Auth0 shows for a misconfigured request.
 */
import { escapeHtml as escape, htmlPage } from "../html.ts"

const STYLE = `
  :root { color-scheme: light dark; --ink: #1e212a; --muted: #65676e; --line: #c9cace; --paper: #fff; --brand: #635dff; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f0f0f2; --muted: #a8a9ad; --line: #3e4048; --paper: #17181c; } }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
  main { max-width: 400px; margin: 64px auto; padding: 40px; border: 1px solid var(--line); border-radius: 6px; }
  h1 { font-size: 24px; font-weight: 400; margin: 0 0 8px; text-align: center; }
  p { color: var(--muted); margin: 0 0 24px; text-align: center; }
  label { display: block; font-size: 14px; margin: 12px 0 4px; }
  input { box-sizing: border-box; width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 3px; font: inherit; background: none; color: inherit; }
  button { width: 100%; padding: 12px; margin-top: 20px; border: 0; border-radius: 3px; background: var(--brand); color: #fff; font: inherit; cursor: pointer; }
  .social { background: none; color: inherit; border: 1px solid var(--line); margin-top: 8px; }
  [role="alert"] { color: #d03c38; margin: 8px 0 0; }
  .alt { margin-top: 20px; text-align: center; font-size: 14px; }
`

const page = (title: string, body: string) => htmlPage(title, STYLE, body)

const alert = (error: string | undefined) =>
  error === undefined ? "" : `<p role="alert">${escape(error)}</p>`

/** What a login or signup page shows. */
export interface LoginView {
  readonly state: string
  readonly tenantName: string
  readonly appName: string
  readonly email?: string
  readonly error?: string
  /** Social connections offered as "Continue with …" buttons: connection name and label. */
  readonly social: readonly { readonly connection: string; readonly label: string }[]
}

function socialButtons(view: LoginView): string {
  return view.social
    .map(
      (option) =>
        `<form method="get" action="/authorize/social"><input type="hidden" name="state" value="${escape(view.state)}"><input type="hidden" name="connection" value="${escape(option.connection)}"><button type="submit" class="social">Continue with ${escape(option.label)}</button></form>`,
    )
    .join("")
}

function credentialsForm(view: LoginView, action: string, button: string): string {
  return `<form method="post" action="${action}?state=${encodeURIComponent(view.state)}">
<input type="hidden" name="state" value="${escape(view.state)}">
<label for="username">Email address</label>
<input id="username" name="username" type="email" autocomplete="username" value="${escape(view.email ?? "")}" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
${alert(view.error)}
<button type="submit" name="action" value="default">${button}</button>
</form>`
}

/** The login page: email and password, social buttons, and a link to sign up. */
export function renderLogin(view: LoginView): string {
  return page(
    `Log in | ${view.tenantName}`,
    `<h1>Welcome</h1><p>Log in to ${escape(view.tenantName)} to continue to ${escape(view.appName)}.</p>
${credentialsForm(view, "/u/login", "Continue")}
${socialButtons(view)}
<p class="alt">Don't have an account? <a href="/u/signup?state=${encodeURIComponent(view.state)}">Sign up</a></p>`,
  )
}

/** The signup page: create an account with email and password, or sign up through a social login. */
export function renderSignup(view: LoginView): string {
  return page(
    `Sign up | ${view.tenantName}`,
    `<h1>Create Your Account</h1><p>Sign up to ${escape(view.tenantName)} to continue to ${escape(view.appName)}.</p>
${credentialsForm(view, "/u/signup", "Continue")}
${socialButtons(view)}
<p class="alt">Already have an account? <a href="/u/login?state=${encodeURIComponent(view.state)}">Log in</a></p>`,
  )
}

/** The second step for users with an authenticator app: their current one-time code. */
export function renderOtpChallenge(view: { state: string; error?: string }): string {
  return page(
    "Verify Your Identity",
    `<h1>Verify Your Identity</h1><p>Check your preferred one-time password application for a code.</p>
<form method="post" action="/u/mfa-otp-challenge?state=${encodeURIComponent(view.state)}">
<input type="hidden" name="state" value="${escape(view.state)}">
<label for="code">Enter your one-time code</label>
<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
${alert(view.error)}
<button type="submit" name="action" value="default">Continue</button>
</form>`,
  )
}

/** The page Auth0 stops a request on, such as an unknown client or a callback URL mismatch. */
export function renderError(title: string, description: string): string {
  return page(
    title,
    `<h1>Oops!, something went wrong</h1><p>${escape(title)}</p><p role="alert">${escape(description)}</p>`,
  )
}

/** The page shown after a verification link was opened. */
export function renderEmailVerified(verified: boolean): string {
  return verified
    ? page(
        "Email Verified",
        "<h1>Email Verified</h1><p>Your email was verified. You can continue using the application.</p>",
      )
    : page(
        "Link Expired",
        '<h1>Link Expired</h1><p role="alert">This link has already been used or has expired.</p>',
      )
}

/** Sends the browser back to the app, the way the request's response mode asks. */
export function formPost(redirectUri: string, fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join("")

  return `<!doctype html><body onload="document.forms[0].submit()"><form method="post" action="${escape(redirectUri)}">${inputs}</form></body>`
}
