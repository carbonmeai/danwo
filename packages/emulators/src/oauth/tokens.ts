import { randomBytes, timingSafeEqual } from "node:crypto"

import type { Context } from "../http.ts"
import type { Clock, Collection, Entity } from "../store.ts"

export interface IssuedToken extends Entity {
  token: string
  kind: "access" | "refresh"
  clientId: string
  user: string
  scope: string
  /** `null` for refresh tokens, which last until revoked. */
  expiresAt: string | null
  revoked: boolean
  /** The refresh token an access token came from; revoking it revokes them all. */
  parent: string | null
}

/** A random URL-safe token with `prefix`. */
export function randomToken(prefix: string, bytes = 24): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`
}

/** Seconds an access token lives, as Google and Microsoft report it. */
export const ACCESS_TOKEN_SECONDS = 3599

/** Who a token is for and what it allows. */
export interface Grant {
  readonly clientId: string
  readonly user: string
  readonly scope: string
}

export function issueAccessToken(
  tokens: Collection<IssuedToken>,
  grant: Grant,
  options: { readonly prefix: string; readonly clock: Clock; readonly parent: string | null },
): IssuedToken {
  return tokens.insert({
    token: randomToken(options.prefix, 48),
    kind: "access",
    ...grant,
    expiresAt: new Date(options.clock().getTime() + ACCESS_TOKEN_SECONDS * 1000).toISOString(),
    revoked: false,
    parent: options.parent,
  })
}

export function issueRefreshToken(
  tokens: Collection<IssuedToken>,
  grant: Grant,
  prefix: string,
): IssuedToken {
  return tokens.insert({
    token: randomToken(prefix, 48),
    kind: "refresh",
    ...grant,
    expiresAt: null,
    revoked: false,
    parent: null,
  })
}

/** The token if it is of `kind`, not revoked and not expired. */
export function liveToken(
  tokens: Collection<IssuedToken>,
  value: string,
  kind: IssuedToken["kind"],
  clock: Clock,
): IssuedToken | undefined {
  const found = tokens.findOneBy("token", value)
  const expired = found?.expiresAt != null && Date.parse(found.expiresAt) <= clock().getTime()

  return found && found.kind === kind && !found.revoked && !expired ? found : undefined
}

/** Revokes a token and, for a refresh token, every access token made from it. */
export function revokeToken(tokens: Collection<IssuedToken>, value: string): boolean {
  const found = tokens.findOneBy("token", value)

  if (!found) return false

  for (const token of [found, ...tokens.all().filter((t) => t.parent === found.token)])
    tokens.update(token.id, { revoked: true })

  return true
}

/** A URL-encoded request body as plain fields. */
export async function formFields(c: Context): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await c.req.text()))
}

/** The client id and secret from HTTP Basic auth, or else from the form. */
export function clientCredentials(
  c: Context,
  form: Record<string, string>,
): { readonly clientId: string; readonly secret: string } {
  const basic = /^Basic\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1]

  if (!basic) return { clientId: form.client_id ?? "", secret: form.client_secret ?? "" }

  const [id = "", secret = ""] = Buffer.from(basic, "base64").toString("utf8").split(":")

  return { clientId: decodeURIComponent(id), secret: decodeURIComponent(secret) }
}

/** Compares secrets without leaking where they differ. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)

  return a.length === b.length && timingSafeEqual(a, b)
}

/** The token in `Authorization: Bearer …`. */
export function bearerToken(c: Context): string | undefined {
  return /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1]
}
