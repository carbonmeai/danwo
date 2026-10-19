/** Auth configs, connected accounts and connect links: creating, finding and moving them along. */
import type { ComposioRouteContext } from "./context.ts"
import type {
  AccountStatus,
  AuthConfigRecord,
  ConnectedAccountRecord,
  LinkRecord,
} from "./entities.ts"
import {
  badRequest,
  ComposioError,
  composioId,
  CONNECT_ORIGIN,
  iso,
  newUuid,
  notFound,
  wordId,
} from "./helpers.ts"
import type { ComposioStore } from "./store.ts"

/** How long a hosted connect link stays usable. */
const LINK_LIFETIME_MS = 10 * 60_000

type Context = Pick<ComposioRouteContext, "objects" | "clock">

export function authConfigOf(objects: ComposioStore, id: string): AuthConfigRecord {
  const config = objects.authConfigs.get(id)

  if (!config) throw notFound("Auth config", id, 1803, "AuthConfig_NotFound")

  return config
}

export function accountOf(objects: ComposioStore, id: string): ConnectedAccountRecord {
  const account = objects.accounts.get(id)

  if (!account) throw notFound("Connected account", id, 1400, "ConnectedAccount_NotFound")

  return account
}

/** Applies `changes` to an account and stamps it updated. */
export function changeAccount(
  context: Context,
  id: string,
  changes: Partial<ConnectedAccountRecord>,
): ConnectedAccountRecord {
  const changed = context.objects.accounts.change(id, {
    ...changes,
    updatedAt: iso(context.clock()),
  })

  if (!changed) throw notFound("Connected account", id, 1400, "ConnectedAccount_NotFound")

  return changed
}

/** A new connected account for `userId` on `config`, in `status`. */
export function newAccount(
  context: Context,
  config: AuthConfigRecord,
  userId: string,
  fields: {
    readonly status: AccountStatus
    readonly val?: Record<string, unknown>
    readonly alias?: string | null
    readonly statusReason?: string | null
  },
): ConnectedAccountRecord {
  const now = iso(context.clock())

  return context.objects.accounts.add(
    {
      id: composioId("ca"),
      uuid: newUuid(),
      userId,
      authConfigId: config.id,
      toolkit: config.toolkit,
      status: fields.status,
      statusReason: fields.statusReason ?? null,
      alias: fields.alias ?? null,
      wordId: wordId(config.toolkit),
      disabled: false,
      val: fields.val ?? {},
      label: null,
      createdAt: now,
      updatedAt: now,
    },
    null,
  )
}

/** A hosted connect link for `account`, and the URL the user opens. */
export function newLink(
  context: Context,
  account: ConnectedAccountRecord,
  callbackUrl: string | null,
): { readonly link: LinkRecord; readonly url: string } {
  const link = context.objects.links.add(
    {
      id: composioId("lk", 16),
      accountId: account.id,
      callbackUrl,
      verifier: null,
      expiresAt: iso(new Date(context.clock().getTime() + LINK_LIFETIME_MS)),
    },
    null,
  )

  return { link, url: `${CONNECT_ORIGIN}/link/${link.id}` }
}

/** A link that has not expired, or undefined. */
export function liveLink(context: Context, id: string): LinkRecord | undefined {
  const link = context.objects.links.get(id)

  return link && Date.parse(link.expiresAt) > context.clock().getTime() ? link : undefined
}

/** Refuses accounts a tool cannot run on: disabled, or not active. */
function usable(account: ConnectedAccountRecord): ConnectedAccountRecord {
  if (account.disabled)
    throw new ComposioError(
      422,
      1404,
      "ConnectedAccount_Disabled",
      `Connected account ${account.id} is disabled`,
    )
  if (account.status !== "ACTIVE")
    throw new ComposioError(
      422,
      1405,
      "ConnectedAccount_NotActive",
      `Connected account ${account.id} is ${account.status}, not ACTIVE`,
    )

  return account
}

/**
 * The account a call for `toolkit` runs on: the one it names, or the user's newest active one for
 * that toolkit.
 */
export function accountForCall(
  objects: ComposioStore,
  toolkit: string,
  request: { readonly accountId?: string | undefined; readonly userId?: string | undefined },
): ConnectedAccountRecord {
  if (request.accountId !== undefined) {
    const account = accountOf(objects, request.accountId)

    if (account.toolkit !== toolkit)
      throw badRequest(`Connected account ${account.id} is for ${account.toolkit}, not ${toolkit}`)

    return usable(account)
  }

  if (request.userId === undefined)
    throw badRequest("Either connected_account_id or user_id is required")

  const candidates = objects.accounts.where(
    (a) => a.userId === request.userId && a.toolkit === toolkit,
  )
  const active = candidates.filter((a) => a.status === "ACTIVE" && !a.disabled).at(-1)

  if (active) return active

  const latest = candidates.at(-1)

  if (latest) return usable(latest)

  throw new ComposioError(
    404,
    1401,
    "ConnectedAccount_NotFoundForUser",
    `No connected account found for user ${request.userId} and toolkit ${toolkit}`,
  )
}
