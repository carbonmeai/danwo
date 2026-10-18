import type { Context } from "../../http.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0TenantRecord, Auth0TransactionRecord, Auth0UserRecord } from "../entities.ts"
import { clientOf, finishLogin } from "../flow.ts"
import { checkPassword, requireTenant } from "../helpers.ts"
import { otpMatches } from "../otp.ts"
import {
  type LoginView,
  renderEmailVerified,
  renderError,
  renderLogin,
  renderOtpChallenge,
  renderSignup,
} from "../pages.ts"
import type { Auth0Store } from "../store.ts"
import { createDatabaseUser, SOCIAL_LABELS } from "../users.ts"

/** The signup rule Auth0's default database connection enforces. */
const MIN_PASSWORD = 8

/** A login in progress on this tenant, by the `state` the pages carry. */
function transactionOf(c: Context, context: Auth0RouteContext, tenant: Auth0TenantRecord) {
  const state = c.req.query("state") ?? ""
  const txn = context.auth0().transactions.findOneBy("txn", state)

  return txn?.tenant === tenant.domain ? txn : undefined
}

function viewFor(
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  txn: Auth0TransactionRecord,
  extra: Partial<LoginView> = {},
): LoginView {
  const auth0 = context.auth0()
  const social = auth0.connections.findBy("tenant", tenant.domain).map((connection) => ({
    connection: connection.name,
    label: SOCIAL_LABELS[connection.name] ?? connection.name,
  }))

  return {
    state: txn.txn,
    tenantName: tenant.friendlyName,
    appName: clientOf(auth0, txn)?.name ?? "the application",
    social,
    ...extra,
  }
}

const expired = (c: Context) =>
  c.html(
    renderError(
      "invalid_request",
      "The login session has expired. Go back to the application and start again.",
    ),
    400,
  )

/** The first factor is done: users with an authenticator go on to the code, everyone else back to the app. */
function afterFirstFactor(
  c: Context,
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  txn: Auth0TransactionRecord,
  user: Auth0UserRecord,
  method: string,
) {
  const auth0 = context.auth0()

  if (user.mfaSecret !== null) {
    auth0.transactions.update(txn.id, { pendingUser: user.user_id, method })

    return c.redirect(`/u/mfa-otp-challenge?state=${encodeURIComponent(txn.txn)}`, 302)
  }

  return finishLogin(c, {
    auth0,
    clock: context.clock,
    tenant,
    txn: { ...txn, method },
    user,
    mfa: false,
  })
}

async function credentials(c: Context): Promise<{ username: string; password: string }> {
  const form = new URLSearchParams(await c.req.text())

  return {
    username: (form.get("username") ?? "").trim().toLowerCase(),
    password: form.get("password") ?? "",
  }
}

/** A submitted login or signup form, with a way to show the form again with an error. */
interface Submission {
  readonly auth0: Auth0Store
  readonly tenant: Auth0TenantRecord
  readonly txn: Auth0TransactionRecord
  readonly username: string
  readonly password: string
  readonly again: (error: string) => Response
}

/** A Universal Login form at `path`: shown on GET, handed to `submit` on POST. */
function formRoutes(
  context: Auth0RouteContext,
  path: string,
  render: (view: LoginView) => string,
  submit: (c: Context, form: Submission) => Response,
): void {
  context.app.get(path, (c) => {
    const tenant = requireTenant(c, context.auth0())
    const txn = transactionOf(c, context, tenant)

    return txn ? c.html(render(viewFor(context, tenant, txn))) : expired(c)
  })

  context.app.post(path, async (c) => {
    const auth0 = context.auth0()
    const tenant = requireTenant(c, auth0)
    const txn = transactionOf(c, context, tenant)

    if (!txn) return expired(c)

    const { username, password } = await credentials(c)
    const again = (error: string) =>
      c.html(render(viewFor(context, tenant, txn, { email: username, error })), 400)

    return submit(c, { auth0, tenant, txn, username, password, again })
  })
}

function loginRoutes(context: Auth0RouteContext): void {
  formRoutes(
    context,
    "/u/login",
    renderLogin,
    (c, { auth0, tenant, txn, username, password, again }) => {
      const user = auth0.users
        .findBy("email", username)
        .find((found) => found.tenant === tenant.domain)

      if (!user || !checkPassword(password, user.passwordHash))
        return again("Wrong email or password")
      if (user.blocked)
        return again("Your account has been blocked after multiple consecutive login attempts.")

      return afterFirstFactor(c, context, tenant, txn, user, "password")
    },
  )
}

function signupRoutes(context: Auth0RouteContext): void {
  formRoutes(
    context,
    "/u/signup",
    renderSignup,
    (c, { auth0, tenant, txn, username, password, again }) => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) return again("Email is not valid.")
      if (auth0.users.findBy("email", username).some((found) => found.tenant === tenant.domain))
        return again("Something went wrong, please try again later")
      if (password.length < MIN_PASSWORD)
        return again(`Your password must contain at least ${MIN_PASSWORD} characters`)

      const user = createDatabaseUser(auth0, tenant.domain, { email: username, password })

      return afterFirstFactor(c, context, tenant, txn, user, "signup")
    },
  )
}

function otpRoutes(context: Auth0RouteContext): void {
  const { app, clock } = context

  const pendingOf = (c: Context) => {
    const auth0 = context.auth0()
    const tenant = requireTenant(c, auth0)
    const txn = transactionOf(c, context, tenant)
    const user = txn?.pendingUser ? auth0.users.findOneBy("user_id", txn.pendingUser) : undefined

    return { tenant, txn, user }
  }

  app.get("/u/mfa-otp-challenge", (c) => {
    const { txn, user } = pendingOf(c)

    return txn && user ? c.html(renderOtpChallenge({ state: txn.txn })) : expired(c)
  })

  app.post("/u/mfa-otp-challenge", async (c) => {
    const { tenant, txn, user } = pendingOf(c)

    if (!txn || !user || user.mfaSecret === null) return expired(c)

    const code = new URLSearchParams(await c.req.text()).get("code") ?? ""

    if (!otpMatches(user.mfaSecret, code, clock()))
      return c.html(
        renderOtpChallenge({ state: txn.txn, error: "The code you entered is invalid" }),
        400,
      )

    return finishLogin(c, { auth0: context.auth0(), clock, tenant, txn, user, mfa: true })
  })
}

/** The link in a verification email: marks the address verified once. */
function verificationRoutes(context: Auth0RouteContext): void {
  context.app.get("/u/email-verification", (c) => {
    const auth0 = context.auth0()
    const email = auth0.emails.findOneBy("ticket", c.req.query("ticket") ?? "")

    if (!email || email.used) return c.html(renderEmailVerified(false), 400)

    auth0.emails.update(email.id, { used: true })

    for (const user of auth0.users
      .findBy("email", email.to)
      .filter((found) => found.tenant === email.tenant))
      auth0.users.update(user.id, { email_verified: true })

    return c.html(renderEmailVerified(true))
  })
}

/** Universal Login: the login, signup and one-time-code pages, and email verification links. */
export function universalLoginRoutes(context: Auth0RouteContext): void {
  for (const register of [loginRoutes, signupRoutes, otpRoutes, verificationRoutes])
    register(context)
}
