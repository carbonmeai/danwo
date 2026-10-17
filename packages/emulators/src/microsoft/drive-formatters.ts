import { createHash } from "node:crypto"

import type { Drive, DriveItem, Permission } from "@microsoft/microsoft-graph-types"

import type { GraphState } from "./context.ts"
import { bytesUsed, childrenOf, parentPath } from "./drive.ts"
import type { DriveItemRecord, DriveRecord, MicrosoftUser, SharingLinkRecord } from "./entities.ts"

/** Where the emulator serves file bytes and upload sessions: Graph's host, outside `/v1.0`. */
export const GRAPH_ORIGIN = "https://graph.microsoft.com"

const QUOTA = 1024 ** 4

function identity(user: MicrosoftUser | undefined) {
  return { user: { id: user?.oid ?? "", displayName: user?.name ?? "", email: user?.email ?? "" } }
}

function webUrl(drive: DriveRecord, path: string): string {
  return drive.driveType === "personal"
    ? `https://onedrive.live.com/?id=${encodeURIComponent(path)}`
    : `https://contoso-my.sharepoint.com/personal/${drive.owner}/Documents${path}`
}

export function driveObject(
  state: GraphState,
  drive: DriveRecord,
  owner: MicrosoftUser | undefined,
) {
  const used = bytesUsed(state, drive)

  return {
    id: drive.graphId,
    driveType: drive.driveType,
    name: "OneDrive",
    createdDateTime: drive.created_at,
    lastModifiedDateTime: drive.updated_at,
    webUrl: webUrl(drive, ""),
    owner: identity(owner),
    quota: { total: QUOTA, used, remaining: QUOTA - used, deleted: 0, state: "normal" },
  } satisfies Drive
}

function fileFacet(item: DriveItemRecord) {
  const bytes = Buffer.from(item.content ?? "", "base64")

  return {
    file: {
      mimeType: item.mimeType ?? "application/octet-stream",
      hashes: { sha256Hash: createHash("sha256").update(bytes).digest("hex").toUpperCase() },
    },
    "@microsoft.graph.downloadUrl": `${GRAPH_ORIGIN}/download/${item.downloadToken}`,
  }
}

/** The bytes of a file item. */
function contentOf(item: DriveItemRecord): Buffer {
  return Buffer.from(item.content ?? "", "base64")
}

export function driveItemObject(state: GraphState, drive: DriveRecord, item: DriveItemRecord) {
  const owner = state.microsoft().users.findOneBy("oid", item.owner)
  const isRoot = item.parentId === null
  const size = item.isFolder
    ? childrenOf(state, item).reduce((sum, child) => sum + contentOf(child).length, 0)
    : contentOf(item).length
  const path = isRoot ? "" : `${parentPath(state, item).slice("/drive/root:".length)}/${item.name}`

  return {
    "@odata.etag": `"{${item.graphId}},${item.version}"`,
    id: item.graphId,
    name: item.name,
    size,
    createdDateTime: item.created_at,
    lastModifiedDateTime: item.updated_at,
    eTag: `"{${item.graphId}},${item.version}"`,
    cTag: `"c:{${item.graphId}},${item.version}"`,
    webUrl: webUrl(drive, path),
    createdBy: identity(owner),
    lastModifiedBy: identity(owner),
    parentReference: {
      driveId: drive.graphId,
      driveType: drive.driveType,
      ...(item.parentId && { id: item.parentId, path: parentPath(state, item) }),
    },
    fileSystemInfo: { createdDateTime: item.created_at, lastModifiedDateTime: item.updated_at },
    ...(item.isFolder
      ? { folder: { childCount: childrenOf(state, item).length } }
      : fileFacet(item)),
    ...(isRoot && { root: {} }),
  } satisfies DriveItem & { "@odata.etag": string }
}

/** A deleted item as a drive delta reports it. */
export function deletedItemObject(drive: DriveRecord, id: string) {
  return {
    id,
    deleted: { state: "deleted" },
    parentReference: { driveId: drive.graphId, driveType: drive.driveType },
  } satisfies DriveItem
}

export function sharingLinkObject(drive: DriveRecord, link: SharingLinkRecord) {
  return {
    id: link.graphId,
    roles: [link.type === "edit" ? "write" : "read"],
    shareId: `s!${link.graphId}`,
    link: {
      type: link.type,
      scope: link.scope,
      webUrl:
        drive.driveType === "personal"
          ? `https://1drv.ms/u/s!${link.graphId}`
          : `https://contoso-my.sharepoint.com/:u:/g/personal/${link.graphId}`,
    },
  } satisfies Permission
}

export function ownerPermission(owner: MicrosoftUser | undefined) {
  return {
    id: "aTowIy5mfG1lbWJlcnNoaXB8b3duZXI",
    roles: ["owner"],
    grantedToV2: { user: { id: owner?.oid ?? "", displayName: owner?.name ?? "" } },
  } satisfies Permission
}
