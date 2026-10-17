import type { Context } from "../http.ts"
import type { Clock } from "../store.ts"
import type { TokenRecord } from "./entities.ts"
import { type Args, SlackApiError, stringArg } from "./helpers.ts"
import type { SlackStore } from "./store.ts"

/** The token a call carries: `Authorization: Bearer …`, or a `token` argument. */
export function tokenOf(c: Context, args: Args): string | undefined {
  const header = c.req.header("authorization") ?? ""
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1]

  return bearer ?? stringArg(args, "token")
}

/**
 * The live token behind `value`, or the error Slack answers: `not_authed` without one,
 * `invalid_auth` for an unknown one, `token_revoked` and `token_expired` for dead ones.
 */
export function authenticate(slack: SlackStore, value: string | undefined, clock: Clock) {
  if (value === undefined) throw new SlackApiError("not_authed")

  const token = slack.tokens.findOneBy("token", value)

  if (!token) throw new SlackApiError("invalid_auth")
  if (token.revoked) throw new SlackApiError("token_revoked")
  if (token.expiresAt !== null && token.expiresAt <= clock().getTime())
    throw new SlackApiError("token_expired")

  return token
}

/** Refuses a token that holds none of `scopes`, with Slack's `needed` and `provided` fields. */
export function requireScope(token: TokenRecord, scopes: readonly string[]): void {
  if (scopes.length === 0 || scopes.some((scope) => token.scopes.includes(scope))) return

  throw new SlackApiError("missing_scope", {
    needed: scopes.join(","),
    provided: token.scopes.join(","),
  })
}

/** Whether `token` holds `scope`. */
export function hasScope(token: TokenRecord, scope: string): boolean {
  return token.scopes.includes(scope)
}
