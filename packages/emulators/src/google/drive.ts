import { createHash, randomBytes, randomInt } from "node:crypto"

import type { drive_v3 } from "googleapis"

import type { DataKey } from "../store.ts"
import { type Caller, GoogleApiError, notFound } from "./api.ts"
import type { DriveFileRecord, GoogleUser } from "./entities.ts"
import { notifyChannels, type PushContext } from "./push.ts"
import { driveFileOnly } from "./scopes.ts"
import { googleStore } from "./store.ts"

/**
 * Drive files and folders. Each user has a root folder ("My Drive"). A file is visible to its
 * owner and to users it is shared with; a token with only `drive.file` sees just the files its
 * own app created. Every change is numbered for `changes.list` and told to watching channels.
 */

type File = drive_v3.Schema$File

export const FOLDER = "application/vnd.google-apps.folder"

/** A 33-character Drive-style file id. */
function driveFileId(): string {
  return `1${randomBytes(24).toString("base64url").slice(0, 32)}`
}

/** A numeric permission id, the shape Drive gives user permissions. */
function permissionId(): string {
  return Array.from({ length: 20 }, () => randomInt(10)).join("")
}

/** The `drive#user` resource for a Google account. */
export function driveUser(user: GoogleUser, me: boolean): drive_v3.Schema$User {
  return {
    kind: "drive#user",
    displayName: user.name,
    emailAddress: user.email,
    permissionId: user.uid.slice(0, 20),
    me,
  }
}

/** Where the file id of a user's "My Drive" root folder is kept. */
function rootKey(uid: string): DataKey<string> {
  return { name: `drive.root.${uid}` }
}

/** The user's "My Drive" root folder, created on first use. */
export function rootOf(push: PushContext, user: GoogleUser): DriveFileRecord {
  const files = googleStore(push.store).files
  const key = rootKey(user.uid)
  const existing = push.store.getData(key)
  const found = existing === undefined ? undefined : files.findOneBy("fileId", existing)

  if (found) return found

  const now = push.clock().toISOString()
  const fileId = `0A${randomBytes(12).toString("base64url")}Uk9PVA`
  const root = files.insert({
    fileId,
    owner: user.uid,
    file: {
      kind: "drive#file",
      id: fileId,
      name: "My Drive",
      mimeType: FOLDER,
      createdTime: now,
      modifiedTime: now,
    },
    content: null,
    createdBy: null,
    permissions: [],
  })

  push.store.setData(key, fileId)

  return root
}

/** Whether a file is some user's "My Drive" root folder. */
export function isRoot(push: PushContext, record: DriveFileRecord): boolean {
  return push.store.getData(rootKey(record.owner)) === record.fileId
}

/** The `uid`s of everyone a file is shared with by email. */
function sharedWithUids(push: PushContext, record: DriveFileRecord): string[] {
  const users = googleStore(push.store).users

  return record.permissions.flatMap((permission) => {
    const user = permission.emailAddress
      ? users.findOneBy("email", permission.emailAddress)
      : undefined

    return user ? [user.uid] : []
  })
}

/** Everyone who can see a file: its owner and the users it is shared with. */
function viewersOf(push: PushContext, record: DriveFileRecord): string[] {
  return [record.owner, ...sharedWithUids(push, record)]
}

/** Whether `caller` may see `record` at all. */
export function canSee(push: PushContext, caller: Caller, record: DriveFileRecord): boolean {
  if (driveFileOnly(caller.scope) && record.createdBy !== caller.clientId) return false

  return viewersOf(push, record).includes(caller.user.uid)
}

/** Whether `caller` may change `record`: its owner or a writer. */
function canWrite(push: PushContext, caller: Caller, record: DriveFileRecord): boolean {
  if (record.owner === caller.user.uid) return true

  return record.permissions.some(
    (permission) =>
      permission.emailAddress === caller.user.email &&
      (permission.role === "writer" || permission.role === "organizer"),
  )
}

/** The file with `fileId` (or `root`) as `caller` sees it, or Drive's 404. */
export function fileOf(push: PushContext, caller: Caller, fileId: string): DriveFileRecord {
  const id = fileId === "root" ? rootOf(push, caller.user).fileId : fileId
  const found = googleStore(push.store).files.findOneBy("fileId", id)

  if (!found || !canSee(push, caller, found)) throw notFound(`File not found: ${fileId}.`)

  return found
}

/** The file, if `caller` may change it, or Drive's 403. */
export function writableFile(push: PushContext, caller: Caller, fileId: string): DriveFileRecord {
  const record = fileOf(push, caller, fileId)

  if (!canWrite(push, caller, record))
    throw new GoogleApiError(
      403,
      "insufficientFilePermissions",
      "The user does not have sufficient permissions for this file.",
    )

  return record
}

/** What each change tells a channel watching the file itself. */
export type FileChange =
  | { readonly state: "update"; readonly changed: string }
  | { readonly state: "trash" | "untrash" | "remove" }

/** Numbers a change for `changes.list` and tells the channels watching it. */
export function recordChange(push: PushContext, record: DriveFileRecord, change: FileChange): void {
  const viewers = viewersOf(push, record)

  googleStore(push.store).changes.insert({
    fileId: record.fileId,
    removed: change.state === "remove",
    viewers,
  })
  notifyChannels(
    push,
    (target) => target.kind === "file" && target.fileId === record.fileId,
    change.state,
    change.state === "update" ? change.changed : undefined,
  )
  notifyChannels(
    push,
    (target) => target.kind === "changes" && viewers.includes(target.owner),
    "change",
  )
}

/** File fields for new content: size, checksum and a new version. */
function contentFields(file: File, content: Buffer, now: string): File {
  return {
    size: String(content.length),
    md5Checksum: createHash("md5").update(content).digest("hex"),
    version: String(Number(file.version ?? 0) + 1),
    modifiedTime: now,
  }
}

/** Client fields Drive lets a create or update set. */
const WRITABLE = new Set([
  "name",
  "mimeType",
  "description",
  "starred",
  "trashed",
  "properties",
  "appProperties",
  "folderColorRgb",
  "originalFilename",
  "writersCanShare",
  "copyRequiresWriterPermission",
  "contentHints",
])

/** The client-settable fields of a request's metadata. */
export function writableMetadata(metadata: Record<string, unknown>): File {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => WRITABLE.has(key)))
}

/** Creates a file owned by `caller`, from metadata and optional content. */
export function createFile(
  push: PushContext,
  owner: GoogleUser,
  clientId: string | null,
  input: {
    readonly metadata: Record<string, unknown>
    readonly content?: Buffer
    readonly mediaType?: string
  },
): DriveFileRecord {
  const now = push.clock().toISOString()
  const fileId = driveFileId()
  const parents = Array.isArray(input.metadata.parents)
    ? input.metadata.parents.filter((parent): parent is string => typeof parent === "string")
    : [rootOf(push, owner).fileId]
  const base: File = {
    kind: "drive#file",
    id: fileId,
    name: "Untitled",
    mimeType: input.mediaType ?? "application/octet-stream",
    parents,
    createdTime: now,
    modifiedTime: now,
    starred: false,
    trashed: false,
    explicitlyTrashed: false,
    version: "1",
    webViewLink: `https://drive.google.com/file/d/${fileId}/view?usp=drivesdk`,
    ...writableMetadata(input.metadata),
  }
  const file = input.content
    ? { ...base, ...contentFields(base, input.content, now), version: "1" }
    : base
  const record = googleStore(push.store).files.insert({
    fileId,
    owner: owner.uid,
    file,
    content: input.content ? input.content.toString("base64") : null,
    createdBy: clientId,
    permissions: [],
  })

  recordChange(push, record, { state: "update", changed: "content" })

  return record
}

/** Applies changed fields to a stored file and records the change. */
export function updateFile(
  push: PushContext,
  record: DriveFileRecord,
  changes: { readonly file: File; readonly content?: Buffer },
  change: FileChange,
): DriveFileRecord {
  const now = push.clock().toISOString()
  const file: File = {
    ...record.file,
    ...changes.file,
    ...(changes.content && contentFields(record.file, changes.content, now)),
    modifiedTime: now,
  }
  const updated =
    googleStore(push.store).files.update(record.id, {
      file,
      ...(changes.content && { content: changes.content.toString("base64") }),
    }) ?? record

  recordChange(push, updated, change)

  return updated
}

/** The file and everything inside it, for a permanent delete. */
function withDescendants(push: PushContext, record: DriveFileRecord): DriveFileRecord[] {
  const children = googleStore(push.store)
    .files.all()
    .filter((file) => file.file.parents?.includes(record.fileId))

  return [record, ...children.flatMap((child) => withDescendants(push, child))]
}

/** Deletes a file (and a folder's contents) for good. */
export function deleteFile(push: PushContext, record: DriveFileRecord): void {
  for (const doomed of withDescendants(push, record)) {
    recordChange(push, doomed, { state: "remove" })
    googleStore(push.store).files.delete(doomed.id)
  }
}

/** Shares a file: a new permission, and a change for everyone who can now see it. */
export function addPermission(
  push: PushContext,
  record: DriveFileRecord,
  permission: drive_v3.Schema$Permission,
): drive_v3.Schema$Permission {
  const created: drive_v3.Schema$Permission = {
    kind: "drive#permission",
    id: permission.type === "anyone" ? "anyoneWithLink" : permissionId(),
    ...permission,
  }
  const updated =
    googleStore(push.store).files.update(record.id, {
      permissions: [...record.permissions, created],
    }) ?? record

  recordChange(push, updated, { state: "update", changed: "permissions" })

  return created
}

/** The owner's permission, which every file has, followed by the ones it was shared with. */
export function permissionsOf(
  push: PushContext,
  record: DriveFileRecord,
): drive_v3.Schema$Permission[] {
  const owner = googleStore(push.store).users.findOneBy("uid", record.owner)
  const ownerPermission: drive_v3.Schema$Permission = {
    kind: "drive#permission",
    id: record.owner.slice(0, 20),
    type: "user",
    role: "owner",
    ...(owner && { emailAddress: owner.email, displayName: owner.name }),
  }

  return [ownerPermission, ...record.permissions]
}

/** The file as `caller` sees it: owners, and whether they own it. */
export function fileResource(push: PushContext, caller: Caller, record: DriveFileRecord): File {
  const owner = googleStore(push.store).users.findOneBy("uid", record.owner)
  const mine = record.owner === caller.user.uid

  return {
    ...record.file,
    ownedByMe: mine,
    ...(owner && { owners: [driveUser(owner, mine)] }),
    ...(!mine && { shared: true, sharedWithMeTime: record.created_at }),
    ...(mine && record.permissions.length > 0 && { shared: true }),
  }
}
