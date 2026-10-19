import { randomBytes, randomUUID } from "node:crypto"

import { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { NylasContact, NylasEmailName, NylasGrant, NylasProvider } from "./entities.ts"
import { NylasEvents, type NylasTrigger } from "./events.ts"
import { addGrant } from "./grants.ts"
import { seconds } from "./helpers.ts"
import { fileMessage } from "./mail.ts"
import { newEvent } from "./routes/calendar.ts"
import { nylasStore } from "./store.ts"

/** A message already in a seeded mailbox. */
export interface NylasSeedMessage {
  readonly from: string | NylasEmailName
  readonly subject: string
  readonly body?: string
  readonly unread?: boolean
}

/** An event already on a seeded grant's primary calendar; times in Unix seconds. */
export interface NylasSeedEvent {
  readonly title: string
  readonly start: number
  readonly end: number
  readonly participants?: readonly string[]
}

/** A connected account, with what its mailbox, calendar and address book already hold. */
export interface NylasSeedGrant {
  readonly email: string
  /** Kept across resets, so an app's own database can name it; a fresh UUID when unset. */
  readonly id?: string
  readonly provider?: NylasProvider
  readonly name?: string
  readonly scope?: readonly string[]
  readonly messages?: readonly NylasSeedMessage[]
  readonly events?: readonly NylasSeedEvent[]
  readonly contacts?: readonly {
    readonly email: string
    readonly given_name?: string
    readonly surname?: string
  }[]
}

/** Data to load into a Nylas emulator. No webhooks are sent for seeded data. */
export type NylasSeedConfig = Partial<{
  /** The application id notifications and tokens carry. */
  applicationId: string
  /** API keys the application accepts; when none are given, any `nyk_` key is. */
  apiKeys: readonly string[]
  grants: readonly NylasSeedGrant[]
  /** Webhook subscriptions, as the dashboard makes them; `secret` signs `X-Nylas-Signature`. */
  webhooks: readonly {
    readonly url: string
    readonly triggers?: readonly NylasTrigger[]
    readonly secret?: string
  }[]
}>

/** A context for seeding: the real store, with events going nowhere. */
type SeedContext = ReturnType<typeof seedContext>

function seedContext(store: Store) {
  const objects = nylasStore(store)
  const clock: Clock = store.clock

  return {
    objects,
    clock,
    store,
    events: new NylasEvents(new Outbox(clock), clock, objects.applicationId),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- seeding registers no routes, so the app is never reached
    app: undefined as never,
  }
}

function seedGrant(context: SeedContext, seed: NylasSeedGrant): void {
  const { grant } = addGrant(context, {
    email: seed.email,
    ...(seed.id && { id: seed.id }),
    ...(seed.provider && { provider: seed.provider }),
    ...(seed.name && { name: seed.name }),
    ...(seed.scope && { scope: seed.scope }),
  })

  seedMessages(context, grant, seed.messages ?? [])
  seedEvents(context, grant, seed.events ?? [])
  for (const contact of seed.contacts ?? [])
    context.objects.contacts.add(contactFor(grant, contact), null)
}

function seedMessages(
  context: SeedContext,
  grant: NylasGrant,
  messages: readonly NylasSeedMessage[],
): void {
  for (const message of messages) {
    const filed = fileMessage(
      context,
      grant,
      {
        subject: message.subject,
        body: message.body ?? "",
        from: [typeof message.from === "string" ? { email: message.from } : message.from],
        to: [{ email: grant.email }],
      },
      "INBOX",
    )

    if (message.unread === false) context.objects.messages.change(filed.id, { unread: false })
  }
}

function seedEvents(
  context: SeedContext,
  grant: NylasGrant,
  events: readonly NylasSeedEvent[],
): void {
  const calendar = context.objects.calendars.where(
    (cal) => cal.grant_id === grant.id && cal.is_primary,
  )[0]

  if (!calendar) return

  for (const event of events)
    context.objects.events.add(
      newEvent(context, grant, calendar, {
        title: event.title,
        when: { start_time: event.start, end_time: event.end },
        participants: (event.participants ?? []).map((email) => ({ email })),
      }),
      null,
    )
}

function contactFor(
  grant: NylasGrant,
  contact: NonNullable<NylasSeedGrant["contacts"]>[number],
): NylasContact {
  return {
    id: randomBytes(8).toString("hex"),
    grant_id: grant.id,
    object: "contact",
    given_name: contact.given_name ?? null,
    middle_name: null,
    surname: contact.surname ?? null,
    nickname: null,
    company_name: null,
    job_title: null,
    notes: null,
    birthday: null,
    emails: [{ email: contact.email, type: "work" }],
    phone_numbers: [],
    web_pages: [],
    im_addresses: [],
    physical_addresses: [],
    groups: [],
    picture_url: null,
    source: "address_book",
  }
}

/** Loads `config` into a Nylas emulator's store. */
export function seedNylas(store: Store, config: NylasSeedConfig): void {
  const context = seedContext(store)

  if (config.applicationId) context.objects.setApplicationId(config.applicationId)
  if (config.apiKeys?.length) context.objects.addApiKeys(config.apiKeys)
  for (const grant of config.grants ?? []) seedGrant(context, grant)

  for (const webhook of config.webhooks ?? []) {
    const now = seconds(context.clock)

    context.objects.webhooks.add(
      {
        id: randomUUID(),
        description: null,
        trigger_types: [
          ...(webhook.triggers ?? [
            "message.created",
            "event.created",
            "event.updated",
            "grant.created",
            "grant.deleted",
            "grant.expired",
          ]),
        ],
        webhook_url: webhook.url,
        webhook_secret: webhook.secret ?? randomBytes(24).toString("hex"),
        status: "active",
        notification_email_addresses: [],
        status_updated_at: now,
        created_at: now,
        updated_at: now,
      },
      null,
    )
  }
}
