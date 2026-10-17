import { randomUUID } from "node:crypto"

import type { NewRecord } from "../store.ts"
import { recordChange } from "./changes.ts"
import type { GraphState } from "./context.ts"
import type {
  Address,
  MailFolderRecord,
  MessageRecord,
  MicrosoftUser,
  WellKnownFolder,
} from "./entities.ts"
import { graphId, newChangeKey } from "./helpers.ts"

/** The folders every mailbox starts with, and their display names. */
const WELL_KNOWN_FOLDERS: Readonly<Record<WellKnownFolder, string>> = {
  inbox: "Inbox",
  drafts: "Drafts",
  sentitems: "Sent Items",
  deleteditems: "Deleted Items",
  archive: "Archive",
  junkemail: "Junk Email",
}

const WELL_KNOWN_NAMES: readonly WellKnownFolder[] = [
  "inbox",
  "drafts",
  "sentitems",
  "deleteditems",
  "archive",
  "junkemail",
]

/** A mailbox's folders, creating the well-known ones the first time it is opened. */
export function mailFolders(state: GraphState, owner: string): MailFolderRecord[] {
  const folders = state.microsoft().folders

  if (folders.findBy("owner", owner).length === 0)
    for (const wellKnown of WELL_KNOWN_NAMES)
      folders.insert({
        graphId: graphId("AAMkAG"),
        owner,
        displayName: WELL_KNOWN_FOLDERS[wellKnown],
        wellKnown,
        parentId: null,
      })

  return folders.findBy("owner", owner)
}

/** A folder by its id or well-known name (`inbox`, `sentitems`, …). */
export function findFolder(
  state: GraphState,
  owner: string,
  idOrName: string,
): MailFolderRecord | undefined {
  const lower = idOrName.toLowerCase()

  return mailFolders(state, owner).find((f) => f.graphId === idOrName || f.wellKnown === lower)
}

/** A well-known folder; every mailbox has them all. */
export function wellKnownFolder(
  state: GraphState,
  owner: string,
  name: WellKnownFolder,
): MailFolderRecord {
  const folder = findFolder(state, owner, name)

  if (!folder) throw new Error(`mailbox ${owner} has no ${name} folder`)

  return folder
}

export function createFolder(
  state: GraphState,
  owner: string,
  displayName: string,
  parentId: string | null,
): MailFolderRecord {
  mailFolders(state, owner)

  return state.microsoft().folders.insert({
    graphId: graphId("AAMkAG"),
    owner,
    displayName,
    wellKnown: null,
    parentId,
  })
}

/** What a new message may say; anything left out takes a draft's defaults. */
export type MessageFields = Partial<
  Omit<MessageRecord, "id" | "created_at" | "updated_at" | "graphId" | "owner" | "folderId">
>

function newMessage(
  state: GraphState,
  owner: string,
  folderId: string,
  fields: MessageFields,
): NewRecord<MessageRecord> {
  const now = state.clock().toISOString()

  return {
    graphId: graphId("AAMkAGI2"),
    owner,
    folderId,
    subject: "",
    bodyType: "html",
    body: "",
    from: null,
    to: [],
    cc: [],
    bcc: [],
    replyTo: [],
    isRead: false,
    isDraft: false,
    importance: "normal",
    categories: [],
    flagged: false,
    receivedAt: now,
    sentAt: null,
    conversationId: graphId("AAQkAG", 16),
    internetMessageId: `<${randomUUID()}@danwo.outlook.test>`,
    changeKey: newChangeKey(),
    attachments: [],
    ...fields,
  }
}

/** Files a message in a folder and records that it was created there. */
export function addMessage(
  state: GraphState,
  owner: string,
  folderId: string,
  fields: MessageFields,
): MessageRecord {
  const message = state.microsoft().messages.insert(newMessage(state, owner, folderId, fields))

  recordChange(state, {
    owner,
    kind: "message",
    targetId: message.graphId,
    folderId,
    changeType: "created",
  })

  return message
}

/** Changes a message's fields and gives it a new change key. */
export function updateMessage(
  state: GraphState,
  message: MessageRecord,
  changes: MessageFields,
): MessageRecord {
  const updated = state.microsoft().messages.update(message.id, {
    ...changes,
    changeKey: newChangeKey(),
  })

  recordChange(state, {
    owner: message.owner,
    kind: "message",
    targetId: message.graphId,
    folderId: message.folderId,
    changeType: "updated",
  })

  return updated ?? message
}

/** Moves a message to another folder: it leaves one folder's view and enters the other's. */
export function moveMessage(
  state: GraphState,
  message: MessageRecord,
  folderId: string,
): MessageRecord {
  const moved =
    state.microsoft().messages.update(message.id, { folderId, changeKey: newChangeKey() }) ??
    message
  const change = { owner: message.owner, kind: "message", targetId: message.graphId } as const

  recordChange(state, { ...change, folderId: message.folderId, changeType: "deleted" })
  recordChange(state, { ...change, folderId, changeType: "created" })

  return moved
}

/** Removes a message for good. */
function purgeMessage(state: GraphState, message: MessageRecord): void {
  state.microsoft().messages.delete(message.id)
  recordChange(state, {
    owner: message.owner,
    kind: "message",
    targetId: message.graphId,
    folderId: message.folderId,
    changeType: "deleted",
  })
}

/** Deleting moves a message to Deleted Items; deleting it there removes it. */
export function deleteMessage(state: GraphState, message: MessageRecord): void {
  const trash = wellKnownFolder(state, message.owner, "deleteditems")

  if (message.folderId === trash.graphId) purgeMessage(state, message)
  else moveMessage(state, message, trash.graphId)
}

/** The fields a copy of a message keeps. */
export function copyFields(message: MessageRecord): MessageFields {
  const { id: _id, created_at: _created, updated_at: _updated, ...rest } = message
  const { graphId: _graphId, owner: _owner, folderId: _folder, changeKey: _key, ...fields } = rest

  return {
    ...fields,
    attachments: message.attachments.map((a) => ({ ...a, graphId: graphId("AAMkAGA") })),
  }
}

function everyone(message: MessageFields): Address[] {
  return [...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])]
}

/** Puts a copy of a sent message in the inbox of each recipient who has a mailbox here. */
function deliver(state: GraphState, sender: MicrosoftUser, message: MessageFields): void {
  const microsoft = state.microsoft()
  const seen = new Set<string>()

  for (const recipient of everyone(message)) {
    const key = recipient.address.toLowerCase()
    const user = microsoft.users.all().find((u) => u.email.toLowerCase() === key)

    if (!user || seen.has(user.oid)) continue
    seen.add(user.oid)
    addMessage(state, user.oid, wellKnownFolder(state, user.oid, "inbox").graphId, {
      ...message,
      bcc: [],
      from: { name: sender.name, address: sender.email },
      isRead: false,
      isDraft: false,
    })
  }
}

/**
 * Sends a message from `sender`: recipients with a mailbox here receive it, and the sender's copy
 * goes to Sent Items (a draft moves there) unless `saveToSentItems` is false.
 */
export function sendMessage(
  state: GraphState,
  sender: MicrosoftUser,
  message: MessageFields,
  options: { readonly draft?: MessageRecord; readonly saveToSentItems?: boolean } = {},
): void {
  const now = state.clock().toISOString()
  const sent: MessageFields = {
    ...message,
    from: { name: sender.name, address: sender.email },
    isDraft: false,
    isRead: true,
    sentAt: now,
    receivedAt: now,
  }

  deliver(state, sender, sent)

  const sentItems = wellKnownFolder(state, sender.oid, "sentitems").graphId

  if (options.draft) {
    updateMessage(state, options.draft, sent)
    moveMessage(state, options.draft, sentItems)
  } else if (options.saveToSentItems !== false) addMessage(state, sender.oid, sentItems, sent)
}
