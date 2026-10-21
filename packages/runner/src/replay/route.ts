/**
 * Where a step left the browser, as a template a replay can compare with: the app's own origin
 * becomes `app` (its port changes from run to run), and path segments that look generated, such
 * as `cs_test_a1B2c3…`, a UUID or a number, become `:id`.
 */

const PREFIXED_ID = /^[a-z]{2,}_[A-Za-z0-9_]{6,}$/
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const NUMBER = /^\d+$/
/** A long token mixing letters and digits, e.g. a base62 id. */
const TOKEN = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z\d_-]{16,}$/
/**
 * A long token mixing upper and lower case, e.g. a random base64url id that happens to hold no
 * digit (one in thirty 16-character ids). A slug is lower case, so it never looks like one.
 */
const MIXED_CASE_TOKEN = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z\d_-]{16,}$/

function isGenerated(segment: string): boolean {
  return [PREFIXED_ID, UUID, NUMBER, TOKEN, MIXED_CASE_TOKEN].some((pattern) =>
    pattern.test(segment),
  )
}

/** The route of `url` relative to the app at `appOrigin`. */
export function routeOf(url: string, appOrigin: string): string {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return parsed.protocol

  const where = parsed.origin === appOrigin ? "app" : parsed.host
  const path = parsed.pathname
    .split("/")
    .map((segment) => (isGenerated(decodeURIComponent(segment)) ? ":id" : segment))
    .join("/")

  return `${where}${path}`
}
