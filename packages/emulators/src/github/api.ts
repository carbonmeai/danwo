import { createHash, randomBytes } from "node:crypto"

import type { Context, Middleware } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import { credentialOf } from "./auth.ts"
import { GithubApiError } from "./helpers.ts"

/**
 * What every REST call gets on its way out: GitHub's rate limit headers (and a 403 once the
 * hour's allowance is spent), an `ETag` with `If-None-Match` answered by a 304 that does not count
 * against the limit, and the request id and API version headers.
 */

interface Allowance {
  readonly used: number
  /** Unix seconds when the hour's window resets. */
  readonly reset: number
}

/** Requests per hour: 60 without a token, 5,000 with one. */
const limitFor = (credential: string | undefined) => (credential ? 5000 : 60)

/** The key an allowance is stored under; never the credential itself. */
function allowanceKey(credential: string | undefined): string {
  const who = credential
    ? createHash("sha256").update(credential).digest("hex").slice(0, 16)
    : "anonymous"

  return `github.rate.${who}`
}

function currentAllowance(store: Store, key: string, now: number): Allowance {
  const saved = store.getData<Allowance>({ name: key })

  return saved && saved.reset > now ? saved : { used: 0, reset: now + 3600 }
}

function rateHeaders(limit: number, allowance: Allowance): Record<string, string> {
  return {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(Math.max(0, limit - allowance.used)),
    "x-ratelimit-used": String(allowance.used),
    "x-ratelimit-reset": String(allowance.reset),
    "x-ratelimit-resource": "core",
  }
}

/** The response with `headers` added. */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers)

  for (const [name, value] of Object.entries(headers)) merged.set(name, value)

  return new Response(response.body, { status: response.status, headers: merged })
}

/** A 304 when the client already holds this representation, else the response with its ETag. */
async function conditional(c: Context, response: Response): Promise<Response> {
  if (c.req.method !== "GET" || response.status !== 200) return response

  const etag = `W/"${createHash("sha256")
    .update(await response.clone().text())
    .digest("hex")
    .slice(0, 32)}"`

  if (c.req.header("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { etag } })

  return withHeaders(response, { etag })
}

/** The rate limit, conditional requests and standard headers, for every REST path. */
export function restMiddleware(store: Store, clock: Clock): Middleware {
  return async (c, next) => {
    if (c.req.path.startsWith("/login/")) return next()

    const credential = credentialOf(c)
    const key = allowanceKey(credential)
    const limit = limitFor(credential)
    const now = Math.floor(clock().getTime() / 1000)
    const before = currentAllowance(store, key, now)

    if (before.used >= limit)
      throw new GithubApiError(
        403,
        "API rate limit exceeded. Check out the documentation for more details.",
        {
          headers: rateHeaders(limit, before),
        },
      )

    const response = await conditional(c, await next())
    const after = response.status === 304 ? before : { ...before, used: before.used + 1 }

    store.setData<Allowance>({ name: key }, after)

    return withHeaders(response, {
      ...rateHeaders(limit, after),
      "x-github-api-version-selected": "2022-11-28",
      "x-github-media-type": "github.v3; format=json",
      "x-github-request-id": randomBytes(8).toString("hex").toUpperCase(),
    })
  }
}
