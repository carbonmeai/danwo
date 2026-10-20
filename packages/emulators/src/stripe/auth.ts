import type { Middleware } from "../http.ts"
import { stripeError } from "./helpers.ts"

const MISSING_KEY =
  "You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY'). See https://stripe.com/docs/api#authentication for details, or we can help at https://support.stripe.com/."

/** A redacted key as Stripe shows it in errors: `sk_test_****abcd`. */
function redact(key: string): string {
  const prefix = key.match(/^[a-z]+_[a-z]+_/)?.[0] ?? ""

  return `${prefix}****${key.slice(-4)}`
}

/** What a browser may do with a publishable key: create a payment method, and confirm or read an intent. */
const PUBLISHABLE = [
  { method: "POST", path: /^\/v1\/payment_methods$/, intent: false },
  { method: "POST", path: /^\/v1\/(payment|setup)_intents\/([^/]+)\/confirm$/, intent: true },
  { method: "GET", path: /^\/v1\/(payment|setup)_intents\/([^/]+)$/, intent: true },
] as const

/** The client secret a browser call sent, from the query or the form body. */
async function clientSecretOf(c: Parameters<Middleware>[0]): Promise<string | undefined> {
  const query = c.req.query("client_secret")

  if (query !== undefined || c.req.method === "GET") return query

  return new URLSearchParams(await c.req.text()).get("client_secret") ?? undefined
}

/**
 * A publishable key is accepted only where Stripe.js uses one, and on an intent only with that
 * intent's own client secret, as Stripe checks.
 */
async function publishableAllowed(c: Parameters<Middleware>[0]): Promise<boolean> {
  const rule = PUBLISHABLE.find(
    (candidate) => candidate.method === c.req.method && candidate.path.test(c.req.path),
  )

  if (!rule) return false
  if (!rule.intent) return true

  const id = rule.path.exec(c.req.path)?.[2] ?? ""

  return (await clientSecretOf(c))?.startsWith(`${id}_secret_`) ?? false
}

/**
 * Accepts any test-mode secret or restricted key on `/v1/*`, and a test-mode publishable key on
 * the few calls Stripe.js makes with one. Live keys are refused, so a run that is pointed at the
 * emulator by mistake with production credentials fails loudly.
 */
export function stripeApiKey(): Middleware {
  return async (c, next) => {
    if (!c.req.path.startsWith("/v1/")) return next()

    const header = c.req.header("Authorization") ?? ""
    const key = header.replace(/^Bearer\s+/i, "").trim()

    if (!key) return stripeError(c, 401, "invalid_request_error", MISSING_KEY)
    if (/^pk_test_\S+$/.test(key) && (await publishableAllowed(c))) return next()
    if (!/^(sk|rk)_test_\S+$/.test(key))
      return stripeError(
        c,
        401,
        "invalid_request_error",
        `Invalid API Key provided: ${redact(key)}`,
      )

    return next()
  }
}
