import type { Context, Middleware } from "../http.ts"
import type { Account } from "./entities.ts"
import { twilioError } from "./helpers.ts"
import type { TwilioStore } from "./store.ts"

/** The username and password of a Basic `Authorization` header. */
function basicCredentials(c: Context): readonly [string, string] | undefined {
  const header = c.req.header("authorization") ?? ""
  const encoded = /^Basic\s+(\S+)$/i.exec(header)?.[1]

  if (encoded === undefined) return undefined

  const decoded = Buffer.from(encoded, "base64").toString("utf8")
  const colon = decoded.indexOf(":")

  return colon < 0 ? undefined : [decoded.slice(0, colon), decoded.slice(colon + 1)]
}

/**
 * The account a request is made as: an Account SID with its auth token, or an API key SID (`SK…`)
 * with its secret, which acts as the key's account.
 */
function callerOf(c: Context, twilio: TwilioStore): Account | undefined {
  const credentials = basicCredentials(c)

  if (credentials === undefined) return undefined

  const [user, password] = credentials
  const account = twilio.accounts.get(user)

  if (account) return account.authToken === password ? account : undefined

  const key = twilio.keys.get(user)

  return key?.secret === password ? twilio.accounts.get(key.accountSid) : undefined
}

/**
 * Twilio's credential check: a request without valid Basic credentials gets 401 with error 20003,
 * and one whose path names another account than the caller's gets 20003 too.
 */
export function twilioAuth(twilio: TwilioStore): Middleware {
  return async (c, next) => {
    const caller = callerOf(c, twilio)
    const pathAccount = /\/Accounts\/(AC[0-9a-f]{32})\b/.exec(c.req.path)?.[1]

    if (caller === undefined || (pathAccount !== undefined && pathAccount !== caller.id))
      return twilioError(c, 401, 20003, "Authenticate")

    return next()
  }
}

/** The caller of a request that passed `twilioAuth`. */
export function requireCaller(c: Context, twilio: TwilioStore): Account {
  const caller = callerOf(c, twilio)

  if (caller === undefined) throw new Error("requireCaller() outside twilioAuth")

  return caller
}
