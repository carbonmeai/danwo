import type { Middleware } from "../http.ts"
import { composioError } from "./helpers.ts"
import type { ComposioStore } from "./store.ts"

/** Paths a browser reaches without a key: the hosted connect page and the OAuth callback. */
function isBrowserPath(path: string): boolean {
  return path.startsWith("/link/") || /^\/api\/v3(\.1)?\/toolkits\/auth\/callback$/.test(path)
}

/** A key as Composio's errors echo it: the prefix and the last four characters. */
function masked(key: string): string {
  const prefix = /^[a-z]+_/.exec(key)?.[0] ?? ""

  return `${prefix}**${key.slice(-4)}`
}

/**
 * Composio's key check: a project key in `x-api-key` (or a user key in `x-user-api-key`). Without
 * one the API answers 401 `Auth_NoAuthProvided`; a key it does not know gets 401
 * `APIKey_InvalidAPIKey`, both as the live API words them. Any `ak_` key is accepted unless the
 * seed names the project's keys, and then only those are.
 */
export function composioApiKey(objects: ComposioStore): Middleware {
  return async (c, next) => {
    if (isBrowserPath(c.req.path)) return next()

    const key = (c.req.header("x-api-key") ?? c.req.header("x-user-api-key") ?? "").trim()

    if (key === "")
      return composioError(c, 401, 906, "Auth_NoAuthProvided", "No authentication provided")

    const known = objects.apiKeys()
    const accepted = known.length > 0 ? known.includes(key) : /^u?ak_\S+$/.test(key)

    if (!accepted)
      return composioError(
        c,
        401,
        801,
        "APIKey_InvalidAPIKey",
        `Invalid API key: ${masked(key)}`,
        "Please check you are using a valid API key.",
      )

    return next()
  }
}
