/**
 * Where a step left the browser, as a template a replay can compare with: the app's own origin
 * becomes `app` (its port changes from run to run), and path segments that look generated, such
 * as `cs_test_a1B2c3…`, `ord_9xK2`, `PROJ-016`, `8f3a2b1c`, a UUID or a number, become `:id`.
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

/** A short prefixed id with a digit in its tail, as `ord_9xK2`; `ord_new` has none. */
const SHORT_PREFIXED_ID = /^[a-z]{2,}_(?=[A-Za-z]*\d)[A-Za-z\d]{3,}$/
/** A ticket or document number: upper-case letters, a dash and digits, as `PROJ-016`, `INV-2041`. */
const KEYED_NUMBER = /^[A-Z]{2,10}-\d+$/
/** A short hex id with a digit in it, as `8f3a2b1c`; an all-letter word such as `deadbeef` is kept. */
const HEX = /^(?=.*\d)[\da-f]{8,}$|^(?=.*\d)[\dA-F]{8,}$/

/**
 * Letters and digits of 8 or more in at least three runs, as `abc123def` or `a1b2c3d4`. A name
 * with a version, such as `windows11` or `release2026`, has only two.
 */
const MIXED_TOKEN = /^(?=[A-Za-z\d]{8,}$)(?:[A-Za-z]+\d+[A-Za-z]|\d+[A-Za-z]+\d)/

const GENERATED = [
  PREFIXED_ID,
  SHORT_PREFIXED_ID,
  KEYED_NUMBER,
  UUID,
  NUMBER,
  HEX,
  TOKEN,
  MIXED_CASE_TOKEN,
  MIXED_TOKEN,
]

function isGenerated(segment: string): boolean {
  return GENERATED.some((pattern) => pattern.test(segment))
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
