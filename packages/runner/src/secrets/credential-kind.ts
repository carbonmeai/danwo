/**
 * What kind of credential a provider call carried, and whether a browser sent it: facts the
 * flight recorder keeps next to a call, since the credential itself is redacted.
 */

/** A credential's kind and the shape that told it (a key prefix, never the key). */
export interface CredentialKind {
  readonly kind: "secret" | "publishable"
  /** E.g. `sk_test_`, `FLWSECK_TEST-`, `xoxb-`, `Basic`. */
  readonly shape: string
}

/** Key prefixes of server-only keys. */
const SECRET_SHAPE =
  /^(sk_(?:test|live)_|sk_sandbox_|rk_(?:test|live)_|FLWSECK(?:_TEST)?-?|xox[bp]-|xoxe\.xox[bp]-|gh[opsu]_|github_pat_)/

/** Key prefixes of keys meant for the browser. */
const PUBLISHABLE_SHAPE = /^(pk_(?:test|live)_|FLWPUBK(?:_TEST)?-?)/

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
}

/** The key a header value holds: the token after `Bearer`, or the value itself. */
function keyOf(value: string): string {
  return value.replace(/^Bearer\s+/i, "").trim()
}

/** The credential a request carried in `authorization` or `x-api-key`, by its shape. */
export function credentialKind(
  headers: Readonly<Record<string, string>>,
): CredentialKind | undefined {
  const authorization = headerValue(headers, "authorization")

  if (authorization !== undefined && /^Basic\s/i.test(authorization))
    return { kind: "secret", shape: "Basic" }

  const key = keyOf(authorization ?? headerValue(headers, "x-api-key") ?? "")
  const secret = SECRET_SHAPE.exec(key)?.[1]

  if (secret !== undefined) return { kind: "secret", shape: secret }

  const publishable = PUBLISHABLE_SHAPE.exec(key)?.[1]

  return publishable === undefined ? undefined : { kind: "publishable", shape: publishable }
}

/**
 * Whether a browser sent the request: browsers send a `Mozilla/` user agent and `sec-fetch-dest`
 * with every request. Node's own fetch also sends `sec-fetch-mode`, so that one tells nothing.
 */
export function sentByBrowser(headers: Readonly<Record<string, string>>): boolean {
  const agent = headerValue(headers, "user-agent") ?? ""

  return agent.startsWith("Mozilla/") || headerValue(headers, "sec-fetch-dest") !== undefined
}
