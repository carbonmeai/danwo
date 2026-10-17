import { randomUUID } from "node:crypto"

import type { Emulator } from "../define.ts"
import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Context, ErrorHandler } from "../http.ts"
import { type PersonName, personName } from "../oauth/account.ts"
import { createSigningKey } from "../oauth/jwt.ts"
import { type SignIns, signIns } from "../oauth/sign-ins.ts"
import { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { GraphState, MicrosoftRouteContext } from "./context.ts"
import { aadError, CONSUMER_TENANT_ID, graphError, GraphProblem } from "./helpers.ts"
import { subscriptionEndpoints } from "./notifications.ts"
import { UnsupportedFilter } from "./odata.ts"
import { authorizeRoutes } from "./routes/authorize.ts"
import { calendarSyncRoutes } from "./routes/calendar-sync.ts"
import { discoveryRoutes } from "./routes/discovery.ts"
import { driveRoutes } from "./routes/drive.ts"
import { eventRoutes } from "./routes/events.ts"
import { mailFolderRoutes } from "./routes/mail-folders.ts"
import { meRoutes } from "./routes/me.ts"
import { messageRoutes } from "./routes/messages.ts"
import { sendRoutes } from "./routes/send.ts"
import { subscriptionRoutes } from "./routes/subscriptions.ts"
import { tokenRoutes } from "./routes/token.ts"
import {
  type MicrosoftSeedEvent,
  type MicrosoftSeedFile,
  type MicrosoftSeedMessage,
  seedEvent,
  seedFile,
  seedMessage,
} from "./seed.ts"
import { microsoftStore } from "./store.ts"

export type * from "./entities.ts"
export { microsoftOutboundFaults } from "./faults.ts"
export { CONSUMER_TENANT_ID, MICROSOFT_HOSTS } from "./helpers.ts"
export {
  type CalendarEntry,
  type DriveEntry,
  type GraphSubscriptionEntry,
  graphSubscriptions,
  type OutlookMessage,
  type OneDrive,
  oneDrive,
  type OutlookCalendar,
  outlookCalendar,
  type OutlookMailbox,
  outlookMailbox,
  revokeMicrosoftSessions,
} from "./inspect.ts"
export type { MicrosoftSeedEvent, MicrosoftSeedFile, MicrosoftSeedMessage } from "./seed.ts"

/** A seeded account: a personal one unless `tenant_id` names a work directory. */
export type MicrosoftSeedUser = { readonly email: string } & Partial<
  PersonName & { tenant_id: string }
>

export type MicrosoftSeedClient = {
  readonly client_id: string
  readonly client_secret: string
  readonly name: string
  readonly redirect_uris: readonly string[]
  readonly tenant_id?: string
}

/** Accounts, app registrations and their mail, calendars and files, to load into an emulator. */
export type MicrosoftSeedConfig = Partial<{
  readonly users: readonly MicrosoftSeedUser[]
  readonly oauth_clients: readonly MicrosoftSeedClient[]
  readonly mail: readonly MicrosoftSeedMessage[]
  readonly events: readonly MicrosoftSeedEvent[]
  readonly files: readonly MicrosoftSeedFile[]
}>

function addUser(store: Store, seed: MicrosoftSeedUser): void {
  microsoftStore(store).users.insert({
    oid: randomUUID(),
    email: seed.email,
    ...personName(seed.email, seed),
    tenant_id: seed.tenant_id ?? CONSUMER_TENANT_ID,
  })
}

function seedAccounts(store: Store, config: MicrosoftSeedConfig): void {
  for (const user of config.users ?? []) addUser(store, user)

  for (const client of config.oauth_clients ?? [])
    microsoftStore(store).clients.insert({
      ...client,
      redirect_uris: [...client.redirect_uris],
      tenant_id: client.tenant_id ?? "common",
    })
}

function seedContent(state: GraphState, config: MicrosoftSeedConfig): void {
  for (const message of config.mail ?? []) seedMessage(state, message)
  for (const event of config.events ?? []) seedEvent(state, event)
  for (const file of config.files ?? []) seedFile(state, file)
}

/**
 * Loads accounts, app registrations, mail, events and files into a Microsoft emulator: pass the
 * emulator, or just its store.
 */
export function seedMicrosoft(
  target: Store | Pick<Emulator, "store" | "outbox">,
  config: MicrosoftSeedConfig,
): void {
  const store = "outbox" in target ? target.store : target
  const outbox = "outbox" in target ? target.outbox : new Outbox(store.clock)

  seedAccounts(store, config)
  seedContent(graphStateOf(store, outbox), config)
}

function graphStateOf(store: Store, outbox: Outbox): GraphState {
  return { microsoft: () => microsoftStore(store), clock: store.clock, outbox }
}

/** Who signed in to which app, for tests. */
export function microsoftSignIns(emulator: Pick<Emulator, "store">): SignIns {
  return signIns(
    () => microsoftStore(emulator.store),
    (oid) => microsoftStore(emulator.store).users.findOneBy("oid", oid)?.email,
  )
}

function routes(context: MicrosoftRouteContext): void {
  for (const register of [
    discoveryRoutes,
    authorizeRoutes,
    tokenRoutes,
    meRoutes,
    driveRoutes,
    mailFolderRoutes,
    messageRoutes,
    sendRoutes,
    calendarSyncRoutes,
    eventRoutes,
    subscriptionRoutes,
  ])
    register(context)
}

/** The Graph error a thrown failure becomes on a Graph path. */
function graphFailure(c: Context, clock: Clock, error: unknown): Response {
  if (error instanceof GraphProblem)
    return graphError(c, clock, { status: error.status, code: error.code, message: error.message })
  if (error instanceof UnsupportedFilter)
    return graphError(c, clock, {
      status: 400,
      code: "ErrorInvalidUrlQueryFilter",
      message: "The query filter contains one or more invalid nodes.",
    })
  if (error instanceof RangeError)
    return graphError(c, clock, {
      status: 400,
      code: "ErrorInvalidRequest",
      message: error.message,
    })

  const status = error instanceof HttpError ? error.status : 500

  return graphError(c, clock, {
    status,
    code: status === 500 ? "generalException" : "invalidRequest",
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
  })
}

/** Graph paths answer in Graph's error shape; sign-in paths in Entra ID's `AADSTS` one. */
function microsoftErrors(clock: Clock): ErrorHandler {
  return (error, c) => {
    if (/^\/(v1\.0|up|download|monitor)\//.test(c.req.path)) return graphFailure(c, clock, error)

    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : "Internal server error"

    return aadError(c, clock, { status, error: "server_error", code: 90033, message })
  }
}

/** How long Graph waits for a notification endpoint, and when it tries again. */
const NOTIFICATION_POLICY = { retryDelaysMs: [1_000, 5_000, 30_000], timeoutMs: 3_000 }

/**
 * Microsoft sign-in (Entra ID v2.0) and Microsoft Graph on Microsoft's real hostnames: tenant
 * paths, the account picker, tokens with PKCE and refresh, discovery and keys; Graph's `/me`,
 * Outlook mail and calendar, OneDrive, and change notifications.
 */
export const microsoft = defineEmulator({
  name: "microsoft",
  setup({ app, store, clock, outbox }) {
    app.onError(microsoftErrors(clock))
    routes({ app, clock, outbox, microsoft: () => microsoftStore(store), key: createSigningKey() })
  },
  webhooks: ({ store }) => ({
    endpoints: () => subscriptionEndpoints(microsoftStore(store)),
    sign: () => ({ "content-type": "application/json; charset=utf-8" }),
    policy: NOTIFICATION_POLICY,
  }),
})
