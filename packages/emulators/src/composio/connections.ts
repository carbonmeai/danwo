/**
 * Connecting an account: straight away when the caller hands over credentials, otherwise through
 * a hosted link the user opens, which ends on the app's callback URL.
 */
import { asRecord } from "../json.ts"
import { changeAccount, newAccount, newLink } from "./accounts.ts"
import { backendFor } from "./backends/index.ts"
import type { ComposioRouteContext } from "./context.ts"
import type { AuthConfigRecord, ConnectedAccountRecord, LinkRecord } from "./entities.ts"
import { ComposioError, secret } from "./helpers.ts"

type Context = Pick<ComposioRouteContext, "objects" | "clock">

/** Fields of a connection's state that are credentials a tool can run with. */
const CREDENTIALS = [
  "access_token",
  "api_key",
  "generic_api_key",
  "token",
  "bearer_token",
  "username",
]

/** The credentials a create request carried in `connection.state.val`, if any. */
function givenCredentials(state: unknown): Record<string, unknown> | undefined {
  const val = asRecord(asRecord(state)?.["val"])

  return val && CREDENTIALS.some((field) => typeof val[field] === "string") ? { ...val } : undefined
}

/** A connection request: an account waiting on its link, or one already active. */
export interface ConnectionStart {
  readonly account: ConnectedAccountRecord
  readonly link?: { readonly link: LinkRecord; readonly url: string }
}

/**
 * Starts connecting `userId` on `config`. Credentials in `state`, or a toolkit that needs none,
 * make the account ACTIVE at once; anything else waits as INITIATED on a hosted link.
 */
export function startConnection(
  context: Context,
  config: AuthConfigRecord,
  userId: string,
  options: {
    readonly callbackUrl: string | null
    readonly alias: string | null
    readonly state?: unknown
  },
): ConnectionStart {
  if (config.status === "DISABLED")
    throw new ComposioError(
      400,
      1804,
      "AuthConfig_Disabled",
      `Auth config ${config.id} is disabled`,
    )

  const credentials = givenCredentials(options.state)

  if (credentials || config.authScheme === "NO_AUTH")
    return {
      account: newAccount(context, config, userId, {
        status: "ACTIVE",
        val: credentials ?? {},
        alias: options.alias,
      }),
    }

  const account = newAccount(context, config, userId, { status: "INITIATED", alias: options.alias })
  const { link, url } = newLink(context, account, options.callbackUrl)

  return {
    account: changeAccount(context, account.id, { val: { redirectUrl: url } }),
    link: { link, url },
  }
}

/** Marks a connection done: ACTIVE with the credentials it ended with, as `label` at the toolkit. */
export function completeConnection(
  context: Context,
  account: ConnectedAccountRecord,
  val: Readonly<Record<string, unknown>>,
  label: string | null,
): ConnectedAccountRecord {
  return changeAccount(context, account.id, {
    status: "ACTIVE",
    statusReason: null,
    val: { ...val },
    label,
  })
}

/** Marks a connection failed, with why. */
export function failConnection(
  context: Context,
  account: ConnectedAccountRecord,
  reason: string,
): ConnectedAccountRecord {
  return changeAccount(context, account.id, { status: "FAILED", statusReason: reason, val: {} })
}

/** Credentials for a connection made on the emulator's own page, with no backend behind it. */
export function emulatedCredentials(): Record<string, unknown> {
  return {
    access_token: `emulated_${secret(16)}`,
    refresh_token: `emulated_refresh_${secret(16)}`,
    token_type: "Bearer",
    expires_in: 3600,
  }
}

/** Whether connecting `account` goes through a backend emulator's own consent page. */
export function connectsOnBackend(
  context: ComposioRouteContext,
  config: AuthConfigRecord,
): boolean {
  return config.authScheme === "OAUTH2" && backendFor(context.store, config.toolkit) !== undefined
}
