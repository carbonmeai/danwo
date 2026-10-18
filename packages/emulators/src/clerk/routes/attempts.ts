import type { App, Context } from "../../http.ts"
import { signInJson, signUpJson } from "../attempt-json.ts"
import {
  checkCode,
  type CodeProblem,
  createSignedUpUser,
  newAttempt,
  sendAttemptCode,
} from "../attempts.ts"
import { bodyOf } from "../backend-auth.ts"
import {
  type BrowserRequest,
  browserRequest,
  currentClient,
  formError,
  reply,
} from "../browser-request.ts"
import { type ClerkContext, instanceOf, now } from "../context.ts"
import { ClerkFailure, notFound, str } from "../helpers.ts"
import { startSession } from "../sessions.ts"
import type { AttemptRecord } from "../store.ts"
import { userByEmail } from "./users.ts"

/** The attempt `id` of `kind` on the request's client, or 404. */
function attemptOf(
  context: ClerkContext,
  request: BrowserRequest,
  kind: AttemptRecord["kind"],
  id: string,
): AttemptRecord {
  const attempt = context.clerk.attempts.get(id)

  if (!attempt || attempt.kind !== kind || attempt.client_id !== request.client.id)
    throw notFound(kind === "sign_in" ? "sign in" : "sign up")

  return attempt
}

/** Clerk's error for a code that does not complete an attempt. */
function codeFailure(problem: Exclude<CodeProblem, null>): ClerkFailure {
  if (problem === "too_many")
    return formError(
      "verification_failed",
      "code",
      "Too many failed attempts",
      "Too many failed attempts. You have to try again with the same or another method.",
    )
  if (problem === "expired")
    return formError("verification_expired", "code", "This verification has expired.")

  return formError("form_code_incorrect", "code", "Incorrect code")
}

/** Completes an attempt for `userId`: a new session on the client, named by the attempt. */
function complete(
  context: ClerkContext,
  request: BrowserRequest,
  attempt: AttemptRecord,
  userId: string,
): AttemptRecord {
  const session = startSession(context, currentClient(context, request), userId)

  return (
    context.clerk.attempts.change(attempt.id, {
      status: "complete",
      user_id: userId,
      created_session_id: session.id,
    }) ?? attempt
  )
}

/** Makes `attempt` the client's sign-in or sign-up in progress. */
function track(context: ClerkContext, request: BrowserRequest, attempt: AttemptRecord): void {
  context.clerk.clients.change(request.client.id, {
    ...(attempt.kind === "sign_in" ? { sign_in_id: attempt.id } : { sign_up_id: attempt.id }),
    updated_at: now(context),
  })
}

/** Checks the factor a sign-in offers, completing it when it matches. */
function attemptFirstFactor(
  context: ClerkContext,
  request: BrowserRequest,
  attempt: AttemptRecord,
  body: Record<string, unknown>,
): AttemptRecord {
  const userId = attempt.user_id

  if (userId === null) throw notFound("user")

  const strategy = str(body.strategy)

  if (strategy === "password") {
    if (context.clerk.users.extra(userId)?.password !== str(body.password))
      throw formError(
        "form_password_incorrect",
        "password",
        "Password is incorrect. Try again, or use another method.",
      )

    context.clerk.attempts.change(attempt.id, { strategy: "password" })

    return complete(context, request, attempt, userId)
  }

  if (strategy === "email_code") {
    const problem = checkCode(context, attempt, str(body.code) ?? "")

    if (problem !== null) throw codeFailure(problem)

    return complete(context, request, attempt, userId)
  }

  throw formError(
    "form_param_value_invalid",
    "strategy",
    "is invalid",
    `${strategy ?? "strategy"} is not supported.`,
  )
}

/** `POST /v1/client/sign_ins`: finds the account, and checks a password sent along with it. */
async function createSignIn(c: Context, context: ClerkContext): Promise<Response> {
  const request = browserRequest(c, context)
  const body = await bodyOf(c)
  const identifier = str(body.identifier) ?? ""
  const user = userByEmail(context, identifier)

  if (!user)
    throw formError("form_identifier_not_found", "identifier", "Couldn't find your account.")
  if (user.banned)
    throw new ClerkFailure(
      403,
      "user_banned",
      "Your account is banned.",
      "Your account is locked. Please contact support.",
    )

  const attempt = newAttempt(context, "sign_in", {
    clientId: request.client.id,
    identifier,
    userId: user.id,
    password: null,
  })

  track(context, request, attempt)

  const strategy = str(body.strategy)
  const done =
    strategy === "password" && body.password !== undefined
      ? attemptFirstFactor(context, request, attempt, body)
      : strategy === "email_code"
        ? sendAttemptCode(context, attempt)
        : attempt

  return reply(c, context, request, signInJson(context, done))
}

/** The sign-in routes: create, read, prepare a code and attempt a factor. */
function signInRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/client/sign_ins", (c) => createSignIn(c, context))
  app.get("/v1/client/sign_ins/:id", (c) => {
    const request = browserRequest(c, context)

    return reply(
      c,
      context,
      request,
      signInJson(context, attemptOf(context, request, "sign_in", c.req.param("id"))),
    )
  })
  app.post("/v1/client/sign_ins/:id/prepare_first_factor", async (c) => {
    const request = browserRequest(c, context)
    const attempt = attemptOf(context, request, "sign_in", c.req.param("id"))
    const strategy = str((await bodyOf(c)).strategy)
    const prepared =
      strategy === "email_code"
        ? sendAttemptCode(context, attempt)
        : (context.clerk.attempts.change(attempt.id, { strategy: strategy ?? null }) ?? attempt)

    return reply(c, context, request, signInJson(context, prepared))
  })
  app.post("/v1/client/sign_ins/:id/attempt_first_factor", async (c) => {
    const request = browserRequest(c, context)
    const attempt = attemptOf(context, request, "sign_in", c.req.param("id"))

    return reply(
      c,
      context,
      request,
      signInJson(context, attemptFirstFactor(context, request, attempt, await bodyOf(c))),
    )
  })
}

/** Refuses a taken email address or a short password. */
function checkSignUp(
  context: ClerkContext,
  email: string | undefined,
  password: string | undefined,
): void {
  if (email !== undefined && userByEmail(context, email))
    throw formError(
      "form_identifier_exists",
      "email_address",
      "That email address is taken. Please try another.",
    )
  if (password !== undefined && password.length < 8)
    throw formError(
      "form_password_length_too_short",
      "password",
      "Passwords must be 8 characters or more.",
    )
}

/** The fields a sign-up sets, checked: a free email address and a long enough password. */
function signUpFields(
  context: ClerkContext,
  body: Record<string, unknown>,
): Partial<AttemptRecord> {
  const given = {
    identifier: str(body.email_address),
    password: str(body.password),
    first_name: str(body.first_name),
    last_name: str(body.last_name),
  }

  checkSignUp(context, given.identifier, given.password)

  return Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined))
}

/** Verifies a sign-up's emailed code; a complete sign-up creates the user and signs them in. */
function attemptVerification(
  context: ClerkContext,
  request: BrowserRequest,
  attempt: AttemptRecord,
  code: string,
): AttemptRecord {
  const problem = checkCode(context, attempt, code)

  if (problem !== null) throw codeFailure(problem)
  if (instanceOf(context).password && attempt.password === null) return attempt

  return complete(context, request, attempt, createSignedUpUser(context, attempt))
}

/** The sign-up routes: create, update, read, send the email code and verify it. */
function signUpRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/client/sign_ups", async (c) => {
    const request = browserRequest(c, context)
    const fields = signUpFields(context, await bodyOf(c))
    const created = newAttempt(context, "sign_up", {
      clientId: request.client.id,
      identifier: "",
      userId: null,
      password: null,
    })
    const attempt = context.clerk.attempts.change(created.id, fields) ?? created

    track(context, request, attempt)

    return reply(c, context, request, signUpJson(context, attempt))
  })
  app.get("/v1/client/sign_ups/:id", (c) => {
    const request = browserRequest(c, context)

    return reply(
      c,
      context,
      request,
      signUpJson(context, attemptOf(context, request, "sign_up", c.req.param("id"))),
    )
  })
  app.patch("/v1/client/sign_ups/:id", async (c) => {
    const request = browserRequest(c, context)
    const attempt = attemptOf(context, request, "sign_up", c.req.param("id"))
    const updated =
      context.clerk.attempts.change(attempt.id, signUpFields(context, await bodyOf(c))) ?? attempt

    return reply(c, context, request, signUpJson(context, updated))
  })
  app.post("/v1/client/sign_ups/:id/prepare_verification", (c) => {
    const request = browserRequest(c, context)
    const attempt = attemptOf(context, request, "sign_up", c.req.param("id"))

    return reply(c, context, request, signUpJson(context, sendAttemptCode(context, attempt)))
  })
  app.post("/v1/client/sign_ups/:id/attempt_verification", async (c) => {
    const request = browserRequest(c, context)
    const attempt = attemptOf(context, request, "sign_up", c.req.param("id"))
    const done = attemptVerification(context, request, attempt, str((await bodyOf(c)).code) ?? "")

    return reply(c, context, request, signUpJson(context, done))
  })
}

/**
 * The Frontend API's sign-ins and sign-ups as ClerkJS drives them: an email address, then a
 * password or an emailed six-digit code; a sign-up verifies its email by code before the user is
 * created. A completed attempt starts a session on the browser's client.
 */
export function attemptRoutes(app: App, context: ClerkContext): void {
  signInRoutes(app, context)
  signUpRoutes(app, context)
}
