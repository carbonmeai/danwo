/**
 * The page's calls to Quillwork's API, on the same origin as the page, so the session cookie goes
 * with each one and no CORS is involved. Every write the API takes is safe to send again: a
 * sign-up lands on the same account, and starting a checkout twice gets the same Checkout Session
 * back. So a call that fails on its way (the connection drops, or the server answers 5xx) is
 * tried again a few times before the page shows an error.
 */

/** A team's account, as the API sends it. */
export interface Account {
  readonly email: string
  readonly team: string
  /** `team` while the newest subscription is active or trialing, `free` otherwise. */
  readonly plan: "team" | "free"
  /** The newest subscription's status as Stripe reported it, or "" on the free plan. */
  readonly status: string
}

/** What the API answered when it refused a call, with what is wrong with each field of a form. */
export class ApiError extends Error {
  readonly status: number
  readonly fields: Readonly<Record<string, string>>

  constructor(status: number, message: string, fields: Readonly<Record<string, string>> = {}) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.fields = fields
  }
}

/** Shown when the API could not be reached at all, even after the retries. */
const UNREACHABLE = "Quillwork is not answering just now. Try again in a moment."

/** How long to wait before each retry. */
const RETRY_WAITS_MS = [250, 750, 1500]

type Json = Readonly<Record<string, unknown>>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** An account from the API's JSON, or an error when it is not one. */
function toAccount(value: unknown): Account {
  if (!isObject(value)) throw new ApiError(502, "The API sent an account the page cannot read.")

  return {
    email: text(value.email),
    team: text(value.team),
    plan: value.plan === "team" ? "team" : "free",
    status: text(value.status),
  }
}

/** The error the API's answer describes. */
async function refusal(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined)

  if (!isObject(body)) return new ApiError(response.status, UNREACHABLE)

  const fields = isObject(body.fields)
    ? Object.fromEntries(Object.entries(body.fields).map(([name, value]) => [name, text(value)]))
    : {}

  return new ApiError(response.status, text(body.error) || UNREACHABLE, fields)
}

/** Whether a failed attempt is worth another: no answer at all, or the server failed. */
function retryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500
}

/** One attempt at a call: its JSON body, or the error its answer describes. */
async function attempt(method: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

  if (!response.ok) throw await refusal(response)
  if (response.status === 204) return undefined

  return response.json()
}

/** Calls the API, again after a dropped connection or a 5xx. */
async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt(method, path, body)
    } catch (error) {
      const wait = RETRY_WAITS_MS[tries]

      if (wait === undefined || !retryable(error))
        throw error instanceof ApiError ? error : new ApiError(0, UNREACHABLE)

      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

/** The account the browser is signed in as, or null. */
export async function getSession(): Promise<Account | null> {
  const body = await call("GET", "/api/session")

  return isObject(body) && body.account !== null ? toAccount(body.account) : null
}

/** Creates the team's account and signs the browser in as it. */
export async function signUp(form: { readonly email: string; readonly team: string }) {
  return toAccount(await call("POST", "/api/signup", form))
}

/** Signs the browser out. */
export async function signOut(): Promise<void> {
  await call("POST", "/api/signout", {})
}

/** Starts Stripe Checkout for the Team plan; the URL of Stripe's page to send the browser to. */
export async function startCheckout(): Promise<string> {
  const body = await call("POST", "/api/billing/checkout", {})
  const url = isObject(body) ? text(body.url) : ""

  if (url === "")
    throw new ApiError(502, "Stripe could not start the checkout. Try again in a moment.")

  return url
}
