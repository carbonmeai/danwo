import { randomBytes } from "node:crypto"

import type { calendar_v3 } from "googleapis"

import { Outbox } from "../outbox.ts"
import type { Store } from "../store.ts"
import { insertEvent, primaryCalendar } from "./calendar.ts"
import { createFile, FOLDER, rootOf } from "./drive.ts"
import type { GoogleUser } from "./entities.ts"
import { deliverMessage, mailboxOf, SYSTEM_LABELS } from "./gmail.ts"
import type { IncomingMail } from "./inbox.ts"
import type { PushContext } from "./push.ts"
import { googleStore } from "./store.ts"

/** A message already in a mailbox when the emulator starts. Labels are ids or label names. */
export type GmailSeedMessage = Omit<IncomingMail, "date" | "labelIds"> & {
  readonly date?: Date | string
  readonly labels?: readonly string[]
}

/** A Pub/Sub push subscription: what Gmail publishes to `topic` is POSTed to `endpoint`. */
export interface PubSubSeedSubscription {
  /** `projects/<project>/subscriptions/<name>`. */
  readonly subscription: string
  /** `projects/<project>/topics/<name>`, the topic apps pass to `users.watch`. */
  readonly topic: string
  readonly endpoint: string
  /**
   * Signs each push with an OIDC token for this service account, as a subscription with
   * authentication does. `audience` defaults to `endpoint`.
   */
  readonly oidcToken?: { readonly serviceAccountEmail: string; readonly audience?: string }
}

/** Seeding changes state without notifying anyone: its outbox is never delivered. */
function seedContext(store: Store): PushContext {
  return { store, outbox: new Outbox(store.clock), clock: store.clock }
}

/** The label id for an id or a name, creating a user label for a new name. */
function labelIdFor(push: PushContext, owner: string, label: string): string {
  const labels = googleStore(push.store).labels
  const mine = labels.findBy("owner", owner)
  const found = mine.find(
    (l) => l.labelId === label || l.name.toLowerCase() === label.toLowerCase(),
  )

  if (found) return found.labelId
  if ((SYSTEM_LABELS as readonly string[]).includes(label.toUpperCase())) return label.toUpperCase()

  return labels.insert({
    labelId: `Label_${mine.length + 1}`,
    owner,
    name: label,
    type: "user",
    messageListVisibility: null,
    labelListVisibility: null,
    color: null,
  }).labelId
}

/** Fills mailboxes: `{ "ada@x": [messages] }`. */
export function seedGmail(
  store: Store,
  mailboxes: Readonly<Record<string, readonly GmailSeedMessage[]>>,
): void {
  const push = seedContext(store)
  const users = googleStore(store).users

  for (const [email, messages] of Object.entries(mailboxes)) {
    const user = users.findOneBy("email", email)

    if (!user) throw new Error(`seedGoogle: gmail for ${email}, who is not among the users`)
    mailboxOf(push, user.uid)

    for (const { labels, date, ...mail } of messages)
      deliverMessage(push, user, {
        ...mail,
        ...(date !== undefined && { date: new Date(date) }),
        ...(labels && { labelIds: labels.map((label) => labelIdFor(push, user.uid, label)) }),
        messageIdHeader: `<${randomBytes(12).toString("hex")}@danwo.test>`,
      })
  }
}

/** Registers Pub/Sub push subscriptions. */
export function seedPubSub(store: Store, subscriptions: readonly PubSubSeedSubscription[]): void {
  for (const { subscription, topic, endpoint, oidcToken } of subscriptions)
    googleStore(store).subscriptions.insert({
      name: subscription,
      topic,
      endpoint,
      oidc: oidcToken
        ? {
            serviceAccountEmail: oidcToken.serviceAccountEmail,
            audience: oidcToken.audience ?? null,
          }
        : null,
    })
}

/** An event already on a primary calendar when the emulator starts. */
export type CalendarSeedEvent = calendar_v3.Schema$Event

/** Fills primary calendars: `{ "ada@x": [events] }`. */
export function seedCalendar(
  store: Store,
  calendars: Readonly<Record<string, readonly CalendarSeedEvent[]>>,
): void {
  const push = seedContext(store)

  for (const [email, events] of Object.entries(calendars)) {
    const user = googleStore(store).users.findOneBy("email", email)

    if (!user) throw new Error(`seedGoogle: calendar for ${email}, who is not among the users`)

    const calendar = primaryCalendar(push, user)

    for (const event of events) insertEvent(push, calendar, user, event)
  }
}

/** A file already in a user's Drive when the emulator starts. */
export interface DriveSeedFile {
  readonly name: string
  readonly mimeType?: string
  readonly content?: string | Buffer
  /** A folder in the root to put it in, made if missing. */
  readonly folder?: string
}

/** The id of `owner`'s root folder called `name`, made if missing. */
function folderId(push: PushContext, owner: GoogleUser, name: string): string {
  const root = rootOf(push, owner).fileId
  const found = googleStore(push.store)
    .files.all()
    .find(
      (record) =>
        record.file.name === name &&
        record.file.mimeType === FOLDER &&
        record.file.parents?.includes(root),
    )

  return (found ?? createFile(push, owner, null, { metadata: { name, mimeType: FOLDER } })).fileId
}

/** Fills Drives: `{ "ada@x": [files] }`. */
export function seedDrive(
  store: Store,
  drives: Readonly<Record<string, readonly DriveSeedFile[]>>,
): void {
  const push = seedContext(store)

  for (const [email, files] of Object.entries(drives)) {
    const user = googleStore(store).users.findOneBy("email", email)

    if (!user) throw new Error(`seedGoogle: drive for ${email}, who is not among the users`)

    for (const file of files)
      createFile(push, user, null, {
        metadata: {
          name: file.name,
          ...(file.mimeType && { mimeType: file.mimeType }),
          ...(file.folder && { parents: [folderId(push, user, file.folder)] }),
        },
        ...(file.content !== undefined && { content: Buffer.from(file.content) }),
      })
  }
}
