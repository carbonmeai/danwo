import { randomBytes } from "node:crypto"

import type { App, Context } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { UnipileStore } from "./store.ts"

/** The hosts Unipile answers: every account's DSN (`api8.unipile.com:13851`) and the hosted auth pages. */
export const UNIPILE_HOSTS: readonly string[] = ["*.unipile.com"]

/** Where hosted auth links point. */
export const HOSTED_ORIGIN = "https://account.unipile.com"

export const API = "/api/v1"

/** What every group of Unipile routes is registered with. */
export interface UnipileRouteContext {
  readonly app: App
  readonly objects: UnipileStore
  readonly outbox: Outbox
  readonly clock: Clock
  readonly store: Store
}

/** A failure answered in Unipile's problem-details envelope. */
export class UnipileError extends Error {
  readonly status: number
  readonly type: string
  readonly title: string

  constructor(status: number, type: string, title: string, detail: string) {
    super(detail)
    this.name = "UnipileError"
    this.status = status
    this.type = type
    this.title = title
  }
}

export const notFound = (what: string) =>
  new UnipileError(
    404,
    "errors/resource_not_found",
    "Resource not found.",
    `${what} was not found.`,
  )

export const badRequest = (detail: string) =>
  new UnipileError(400, "errors/invalid_parameters", "Invalid parameters", detail)

/**
 * Unipile's error envelope: `{ status, type, title, detail }`, which the SDK throws as the error's
 * body. Some errors, such as a token Unipile never issued, come without a `detail`.
 */
export function unipileError(
  c: Context,
  status: number,
  type: string,
  title: string,
  detail: string,
): Response {
  return c.json({ status, type, title, ...(detail !== "" && { detail }) }, status)
}

/** Every API call needs the access token in `X-API-KEY`. */
export function requireToken(context: UnipileRouteContext, c: Context): void {
  const token = c.req.header("x-api-key") ?? ""
  const tokens = context.objects.tokens()

  if (token === "")
    throw new UnipileError(
      401,
      "errors/missing_credentials",
      "Missing credentials",
      "The X-API-KEY header is missing.",
    )
  if (tokens.length > 0 && !tokens.includes(token))
    throw new UnipileError(
      401,
      "errors/invalid_credentials",
      "Invalid credentials",
      "",
    )
}

/** A Unipile-style id: 22 base64url characters. */
export const unipileId = () => randomBytes(16).toString("base64url").slice(0, 22)

/**
 * A page of `items` from the cursor's offset, with the cursor to the next page or null, and any
 * `extra` fields the list answers with beside them.
 */
export function listOf(
  c: Context,
  object: string,
  items: readonly unknown[],
  extra: Readonly<Record<string, unknown>> = {},
): Response {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 250)
  const offset = Number(Buffer.from(c.req.query("cursor") ?? "", "base64url").toString() || 0) || 0
  const more = offset + limit < items.length

  return c.json({
    object,
    items: items.slice(offset, offset + limit),
    cursor: more ? Buffer.from(String(offset + limit)).toString("base64url") : null,
    ...extra,
  })
}
