import { randomBytes } from "node:crypto"

import { recordChange } from "./changes.ts"
import type { GraphState } from "./context.ts"
import type { ConflictBehavior, DriveItemRecord, DriveRecord } from "./entities.ts"
import { CONSUMER_TENANT_ID, GraphProblem } from "./helpers.ts"

/** An id in OneDrive's style: `01` and 32 upper-case letters and digits. */
function itemId(): string {
  return `01${randomBytes(20)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .padEnd(32, "Q")
    .slice(0, 32)}`
}

function driveChange(
  state: GraphState,
  item: DriveItemRecord,
  changeType: "created" | "updated" | "deleted",
) {
  recordChange(state, {
    owner: item.owner,
    kind: "drive",
    targetId: item.graphId,
    folderId: item.driveId,
    changeType,
  })
}

/** A user's drive, created with its root folder the first time it is opened. */
export function driveOf(state: GraphState, owner: string): DriveRecord {
  const microsoft = state.microsoft()
  const existing = microsoft.drives.findOneBy("owner", owner)

  if (existing) return existing

  const personal = microsoft.users.findOneBy("oid", owner)?.tenant_id === CONSUMER_TENANT_ID
  const drive = microsoft.drives.insert({
    graphId: personal
      ? randomBytes(8).toString("hex")
      : `b!${randomBytes(48).toString("base64url")}`,
    owner,
    driveType: personal ? "personal" : "business",
  })

  microsoft.items.insert({
    graphId: itemId(),
    owner,
    driveId: drive.graphId,
    name: "root",
    parentId: null,
    isFolder: true,
    content: null,
    mimeType: null,
    version: 1,
    downloadToken: randomBytes(24).toString("base64url"),
  })

  return drive
}

export function rootOf(state: GraphState, drive: DriveRecord): DriveItemRecord {
  const root = state
    .microsoft()
    .items.findBy("driveId", drive.graphId)
    .find((i) => i.parentId === null)

  if (!root) throw new Error(`drive ${drive.graphId} has no root`)

  return root
}

export function childrenOf(state: GraphState, folder: DriveItemRecord): DriveItemRecord[] {
  return state
    .microsoft()
    .items.findBy("driveId", folder.driveId)
    .filter((i) => i.parentId === folder.graphId)
}

export function itemIn(
  state: GraphState,
  drive: DriveRecord,
  id: string,
): DriveItemRecord | undefined {
  const found = state.microsoft().items.findOneBy("graphId", id)

  return found?.driveId === drive.graphId ? found : undefined
}

function childNamed(
  state: GraphState,
  folder: DriveItemRecord,
  name: string,
): DriveItemRecord | undefined {
  return childrenOf(state, folder).find((i) => i.name.toLowerCase() === name.toLowerCase())
}

/** The item at `path` below `start`, or `undefined` if any step is missing. */
export function itemAtPath(
  state: GraphState,
  start: DriveItemRecord,
  path: readonly string[],
): DriveItemRecord | undefined {
  let current: DriveItemRecord | undefined = start

  for (const name of path) current = current && childNamed(state, current, name)

  return current
}

/** The folder path of an item's parent, as `parentReference.path` gives it. */
export function parentPath(state: GraphState, item: DriveItemRecord): string {
  const names: string[] = []
  let parent = item.parentId && state.microsoft().items.findOneBy("graphId", item.parentId)

  while (parent && parent.parentId !== null) {
    names.unshift(parent.name)
    parent = state.microsoft().items.findOneBy("graphId", parent.parentId)
  }

  return `/drive/root:${names.map((n) => `/${n}`).join("")}`
}

/** A name not yet used in the folder: `report.pdf`, then `report 1.pdf`, `report 2.pdf`, … */
function freeName(state: GraphState, folder: DriveItemRecord, name: string): string {
  const dot = name.lastIndexOf(".")
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  let candidate = name

  for (let n = 1; childNamed(state, folder, candidate); n++) candidate = `${stem} ${n}${ext}`

  return candidate
}

/** What to put in a folder: a subfolder, or a file and its bytes. */
export interface NewItem {
  readonly name: string
  readonly content?: Buffer
  readonly mimeType?: string
}

/**
 * Creates a file or folder in `folder`. When the name is taken, `fail` refuses with 409, `rename`
 * picks a free name, and `replace` overwrites the existing file's content.
 */
export function putItem(
  state: GraphState,
  folder: DriveItemRecord,
  item: NewItem,
  conflict: ConflictBehavior,
): { readonly item: DriveItemRecord; readonly created: boolean } {
  const existing = childNamed(state, folder, item.name)

  if (existing && conflict === "fail")
    throw new GraphProblem(
      409,
      "nameAlreadyExists",
      "An item with the same name already exists under the parent.",
    )
  if (existing && conflict === "replace" && item.content)
    return { item: replaceContent(state, existing, item.content, item.mimeType), created: false }

  const created = state.microsoft().items.insert({
    graphId: itemId(),
    owner: folder.owner,
    driveId: folder.driveId,
    name: existing ? freeName(state, folder, item.name) : item.name,
    parentId: folder.graphId,
    isFolder: item.content === undefined,
    content: item.content ? item.content.toString("base64") : null,
    mimeType: item.content ? (item.mimeType ?? "application/octet-stream") : null,
    version: 1,
    downloadToken: randomBytes(24).toString("base64url"),
  })

  driveChange(state, created, "created")

  return { item: created, created: true }
}

/** The folder at `path` below `start`, creating any that are missing. */
export function ensureFolders(
  state: GraphState,
  start: DriveItemRecord,
  path: readonly string[],
): DriveItemRecord {
  let current = start

  for (const name of path)
    current = childNamed(state, current, name) ?? putItem(state, current, { name }, "fail").item

  return current
}

function replaceContent(
  state: GraphState,
  item: DriveItemRecord,
  content: Buffer,
  mimeType?: string,
): DriveItemRecord {
  const updated =
    state.microsoft().items.update(item.id, {
      content: content.toString("base64"),
      version: item.version + 1,
      ...(mimeType && { mimeType }),
    }) ?? item

  driveChange(state, updated, "updated")

  return updated
}

/** Renames and/or moves an item. */
export function updateItem(
  state: GraphState,
  item: DriveItemRecord,
  changes: { readonly name?: string; readonly parentId?: string },
): DriveItemRecord {
  const updated =
    state.microsoft().items.update(item.id, { ...changes, version: item.version + 1 }) ?? item

  driveChange(state, updated, "updated")

  return updated
}

/** Deletes an item and, for a folder, everything in it. */
export function deleteItem(state: GraphState, item: DriveItemRecord): void {
  for (const child of childrenOf(state, item)) deleteItem(state, child)
  state.microsoft().items.delete(item.id)
  driveChange(state, item, "deleted")
}

/** Copies an item (a folder with everything in it) into `folder` under `name`. */
export function copyItem(
  state: GraphState,
  item: DriveItemRecord,
  folder: DriveItemRecord,
  name: string,
): DriveItemRecord {
  const content = item.content === null ? undefined : Buffer.from(item.content, "base64")
  const { item: copy } = putItem(
    state,
    folder,
    { name, ...(content && { content }), ...(item.mimeType && { mimeType: item.mimeType }) },
    "rename",
  )

  for (const child of childrenOf(state, item)) copyItem(state, child, copy, child.name)

  return copy
}

/** Bytes used by a drive's files. */
export function bytesUsed(state: GraphState, drive: DriveRecord): number {
  return state
    .microsoft()
    .items.findBy("driveId", drive.graphId)
    .reduce((sum, item) => sum + (item.content ? Buffer.from(item.content, "base64").length : 0), 0)
}
