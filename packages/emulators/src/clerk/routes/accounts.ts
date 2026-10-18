import { randomInt } from "node:crypto"

import type { App, Context } from "../../http.ts"
import { type ClerkContext, instanceOf, now } from "../context.ts"
import { newUser } from "../entities.ts"
import { clientOf, devBrowserFor } from "../handshake.ts"
import { clerkId, str } from "../helpers.ts"
import { codePage, type PortalState, signInPage, signUpPage } from "../pages.ts"
import { startSession } from "../sessions.ts"
import type { AttemptRecord } from "../store.ts"
import { userByEmail } from "./users.ts"

/** How many wrong codes an attempt takes before it must start over. */
const MAX_CODE_TRIES = 3

/** The app name the portal greets with. */
function appName(context: ClerkContext): string {
  return instanceOf(context).slug
}

/** The portal state of a page request: query parameters, or the fields of a posted form. */
async function stateOf(c: Context): Promise<PortalState & { fields: Record<string, unknown> }> {
  const fields = c.req.method === "POST" ? await c.req.parseBody() : {}
  const read = (name: string) => str(fields[name]) ?? c.req.query(name) ?? ""

  return { redirectUrl: read("redirect_url"), devBrowser: read("__clerk_db_jwt"), fields }
}

/** Sends a six-digit code to `to` and returns it. */
function emailCode(context: ClerkContext, to: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")

  context.clerk.messages.add(
    {
      id: clerkId("msg"),
      to,
      subject: `${code} is your verification code`,
      body: `Enter ${code} to continue to ${appName(context)}. This code expires in 10 minutes.`,
      code,
      sent_at: now(context),
    },
    null,
  )

  return code
}

/** Signs `userId` in on the state's dev browser and sends the browser back to the app. */
function finish(c: Context, context: ClerkContext, state: PortalState, userId: string): Response {
  const devBrowser = devBrowserFor(context, state.devBrowser || undefined)

  startSession(context, clientOf(context, devBrowser), userId)

  if (state.redirectUrl === "") return c.html(`<!doctype html><title>Signed in</title><h1>You are signed in</h1>`)

  const back = new URL(state.redirectUrl)

  back.searchParams.set("__clerk_db_jwt", devBrowser.id)

  return c.redirect(back.toString(), 303)
}

/** A new code attempt for a sign-in or sign-up. */
function newAttempt(
  context: ClerkContext,
  kind: AttemptRecord["kind"],
  email: string,
  fields: { userId: string | null; password: string | null },
): AttemptRecord {
  return context.clerk.attempts.add(
    {
      id: clerkId(kind === "sign_in" ? "sia" : "sua"),
      kind,
      client_id: "",
      identifier: email,
      user_id: fields.userId,
      status: "needs_first_factor",
      code: emailCode(context, email),
      attempts: 0,
      password: fields.password,
      first_name: null,
      last_name: null,
      created_at: now(context),
    },
    null,
  )
}

/** Checks a code against an attempt; an error message for the page, or null when it matches. */
function checkCode(context: ClerkContext, attempt: AttemptRecord, code: string): string | null {
  if (attempt.attempts >= MAX_CODE_TRIES) return "Too many failed attempts. Please start over."
  if (attempt.code === code.trim()) return null

  context.clerk.attempts.change(attempt.id, { attempts: attempt.attempts + 1 })

  return "Incorrect code"
}

async function postSignIn(c: Context, context: ClerkContext): Promise<Response> {
  const state = await stateOf(c)
  const email = str(state.fields.identifier) ?? ""
  const user = userByEmail(context, email)
  const show = (error: string) =>
    c.html(signInPage(state, { password: instanceOf(context).password, appName: appName(context), email, error }), 422)

  if (!user) return show("Couldn't find your account.")
  if (user.banned) return show("Your account is locked. Please contact support for more information.")
  if (!instanceOf(context).password) {
    const attempt = newAttempt(context, "sign_in", email, { userId: user.id, password: null })

    return c.html(codePage(state, { action: "/sign-in/verify", attemptId: attempt.id, email }))
  }

  if (context.clerk.users.extra(user.id)?.password !== str(state.fields.password))
    return show("Password is incorrect. Try again, or use another method.")

  return finish(c, context, state, user.id)
}

async function postVerify(c: Context, context: ClerkContext, kind: AttemptRecord["kind"]): Promise<Response> {
  const state = await stateOf(c)
  const attempt = context.clerk.attempts.get(str(state.fields.attempt) ?? "")

  if (!attempt || attempt.kind !== kind) return c.redirect(`/${kind === "sign_in" ? "sign-in" : "sign-up"}`, 303)

  const error = checkCode(context, attempt, str(state.fields.code) ?? "")

  if (error !== null)
    return c.html(
      codePage(state, { action: `/${kind.replace("_", "-")}/verify`, attemptId: attempt.id, email: attempt.identifier, error }),
      422,
    )

  context.clerk.attempts.change(attempt.id, { status: "complete" })

  const userId = attempt.user_id ?? createSignedUpUser(context, attempt)

  return finish(c, context, state, userId)
}

/** Creates the user a completed sign-up asked for. */
function createSignedUpUser(context: ClerkContext, attempt: AttemptRecord): string {
  const user = newUser({ emails: [attempt.identifier], hasPassword: attempt.password !== null }, now(context))

  return context.clerk.users.add(user, { password: attempt.password }).id
}

async function postSignUp(c: Context, context: ClerkContext): Promise<Response> {
  const state = await stateOf(c)
  const email = str(state.fields.email_address) ?? ""
  const password = str(state.fields.password) ?? ""

  if (userByEmail(context, email))
    return c.html(signUpPage(state, { appName: appName(context), error: "That email address is taken. Please try another." }), 422)
  if (password.length < 8)
    return c.html(signUpPage(state, { appName: appName(context), error: "Passwords must be 8 characters or more." }), 422)

  const attempt = newAttempt(context, "sign_up", email, { userId: null, password })

  return c.html(codePage(state, { action: "/sign-up/verify", attemptId: attempt.id, email }))
}

/** A sign-in token in the link (`__clerk_ticket`) signs its user straight in, once. */
async function ticket(c: Context, context: ClerkContext): Promise<Response | undefined> {
  const value = c.req.query("__clerk_ticket")

  if (value === undefined) return undefined

  const token = context.clerk.signInTokens.where((t) => t.token === value && t.status === "pending")[0]

  if (!token) return c.html(signInPage(await stateOf(c), { password: instanceOf(context).password, appName: appName(context), error: "This link has expired or was already used." }), 422)

  context.clerk.signInTokens.change(token.id, { status: "accepted", updated_at: now(context) })

  return finish(c, context, await stateOf(c), token.user_id)
}

/**
 * The Account Portal on `<slug>.accounts.dev`: the sign-in and sign-up pages Clerk's SDKs send
 * people to. A completed sign-in starts a session on the browser's dev browser and returns to the
 * app with `__clerk_db_jwt`, which makes the app's middleware collect the session in a handshake.
 */
export function accountsRoutes(app: App, context: ClerkContext): void {
  app.get("/sign-in", async (c) =>
    (await ticket(c, context)) ??
    c.html(signInPage(await stateOf(c), { password: instanceOf(context).password, appName: appName(context) })),
  )
  app.post("/sign-in", (c) => postSignIn(c, context))
  app.post("/sign-in/verify", (c) => postVerify(c, context, "sign_in"))
  app.get("/sign-up", async (c) => c.html(signUpPage(await stateOf(c), { appName: appName(context) })))
  app.post("/sign-up", (c) => postSignUp(c, context))
  app.post("/sign-up/verify", (c) => postVerify(c, context, "sign_up"))
}
