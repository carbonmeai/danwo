import type { Emulator } from "../define.ts"
import { defineEmulator } from "../define.ts"
import { type PersonName, personName } from "../oauth/account.ts"
import { createSigningKey, type SigningKey } from "../oauth/jwt.ts"
import { type SignIns, signIns } from "../oauth/sign-ins.ts"
import type { Store } from "../store.ts"
import { googleErrors } from "./api.ts"
import type { GoogleRouteContext } from "./context.ts"
import { newUid } from "./helpers.ts"
import { PUSH_DELIVERY, pushEndpoints, pushHeaders, pushPayload } from "./push.ts"
import { authorizeRoutes } from "./routes/authorize.ts"
import { calendarEventRoutes } from "./routes/calendar-events.ts"
import { calendarListRoutes } from "./routes/calendar-lists.ts"
import { discoveryRoutes } from "./routes/discovery.ts"
import { driveFileRoutes } from "./routes/drive-files.ts"
import { driveSharingRoutes } from "./routes/drive-sharing.ts"
import { driveUploadRoutes } from "./routes/drive-uploads.ts"
import { gmailDraftRoutes } from "./routes/gmail-drafts.ts"
import { gmailHistoryRoutes } from "./routes/gmail-history.ts"
import { gmailLabelRoutes } from "./routes/gmail-labels.ts"
import { gmailMessageRoutes } from "./routes/gmail-messages.ts"
import { gmailThreadRoutes } from "./routes/gmail-threads.ts"
import { revokeRoutes } from "./routes/revoke.ts"
import { tokenRoutes } from "./routes/token.ts"
import { userinfoRoutes } from "./routes/userinfo.ts"
import {
  type CalendarSeedEvent,
  type DriveSeedFile,
  type GmailSeedMessage,
  type PubSubSeedSubscription,
  seedCalendar,
  seedDrive,
  seedGmail,
  seedPubSub,
} from "./seed.ts"
import { googleStore } from "./store.ts"

export type { CalendarEvent, DriveFile } from "./views.ts"
export { googleOutboundFaults } from "./faults.ts"
export { GOOGLE_ENDPOINTS, GOOGLE_HOSTS, GOOGLE_ISSUER } from "./helpers.ts"
export type { SignIn, SignIns } from "../oauth/sign-ins.ts"
export {
  type GmailMailbox,
  gmailMailbox,
  type GoogleCalendar,
  googleCalendar,
  type GoogleDrive,
  googleDrive,
  type IncomingMail,
  type GmailMessage,
  revokeGoogleAccess,
} from "./inbox.ts"
export type {
  CalendarSeedEvent,
  DriveSeedFile,
  GmailSeedMessage,
  PubSubSeedSubscription,
} from "./seed.ts"

/** A seeded Google account; names are split from `name` unless given. */
export type GoogleSeedUser = { readonly email: string } & Partial<
  PersonName & { picture: string; locale: string; email_verified: boolean; hd: string }
>

export type GoogleSeedClient = {
  readonly client_id: string
  readonly client_secret: string
  readonly name: string
  readonly redirect_uris: readonly string[]
}

/** Accounts, OAuth clients and API data to load into a Google emulator. */
export type GoogleSeedConfig = Partial<{
  readonly users: readonly GoogleSeedUser[]
  readonly oauth_clients: readonly GoogleSeedClient[]
  /** Mailbox contents by account email. */
  readonly gmail: Readonly<Record<string, readonly GmailSeedMessage[]>>
  /** Where Gmail's Pub/Sub notifications are pushed. */
  readonly pubsub: readonly PubSubSeedSubscription[]
  /** Primary calendar events by account email. */
  readonly calendar: Readonly<Record<string, readonly CalendarSeedEvent[]>>
  /** Drive files by account email. */
  readonly drive: Readonly<Record<string, readonly DriveSeedFile[]>>
}>

function addUser(store: Store, seed: GoogleSeedUser): void {
  googleStore(store).users.insert({
    uid: newUid(),
    email: seed.email,
    ...personName(seed.email, seed),
    picture: seed.picture ?? null,
    email_verified: seed.email_verified ?? true,
    locale: seed.locale ?? "en",
    hd: seed.hd ?? null,
  })
}

/** Loads accounts and OAuth clients into a Google emulator's store. */
export function seedGoogle(store: Store, config: GoogleSeedConfig): void {
  for (const user of config.users ?? []) addUser(store, user)

  for (const client of config.oauth_clients ?? [])
    googleStore(store).clients.insert({ ...client, redirect_uris: [...client.redirect_uris] })

  seedPubSub(store, config.pubsub ?? [])
  seedGmail(store, config.gmail ?? {})
  seedCalendar(store, config.calendar ?? {})
  seedDrive(store, config.drive ?? {})
}

/** Who signed in to which client, for tests. */
export function googleSignIns(emulator: Pick<Emulator, "store">): SignIns {
  return signIns(
    () => googleStore(emulator.store),
    (uid) => googleStore(emulator.store).users.findOneBy("uid", uid)?.email,
  )
}

function routes(context: GoogleRouteContext): void {
  for (const register of [
    discoveryRoutes,
    authorizeRoutes,
    tokenRoutes,
    userinfoRoutes,
    revokeRoutes,
    gmailMessageRoutes,
    gmailThreadRoutes,
    gmailLabelRoutes,
    gmailDraftRoutes,
    gmailHistoryRoutes,
    calendarListRoutes,
    calendarEventRoutes,
    driveFileRoutes,
    driveUploadRoutes,
    driveSharingRoutes,
  ])
    register(context)
}

/** Each emulator's signing key, shared by its certificate URLs and its signed pushes. */
const signingKeys = new WeakMap<Store, SigningKey>()

function keyOf(store: Store): SigningKey {
  const key = signingKeys.get(store) ?? createSigningKey()

  signingKeys.set(store, key)

  return key
}

/**
 * Google on its real hostnames: sign-in (the account chooser, OpenID Connect discovery, the token
 * endpoint with PKCE and refresh, userinfo, signing keys and revocation), Gmail, Calendar and Drive, each
 * call checked against the scopes the user granted. Gmail's Pub/Sub pushes and the
 * Calendar and Drive watch channels go through the webhook dispatcher.
 */
export const google = defineEmulator({
  name: "google",
  setup({ app, store, clock, outbox }) {
    app.onError(googleErrors())
    routes({ app, clock, store, outbox, google: () => googleStore(store), key: keyOf(store) })
  },
  webhooks: ({ store, outbox, clock }) => ({
    endpoints: () => pushEndpoints({ store, outbox, clock }),
    sign: ({ endpoint, body, timestamp }) =>
      pushHeaders({ store, outbox, clock }, endpoint, body, {
        key: keyOf(store),
        timestamp,
        now: Math.floor(clock().getTime() / 1000),
      }),
    payload: pushPayload,
    policy: PUSH_DELIVERY,
  }),
})
