import type { drive_v3 } from "googleapis"

import type { Context } from "../../http.ts"
import {
  badRequest,
  type Caller,
  GoogleApiError,
  jsonBody,
  pageOf,
  pageSize,
  queryAll,
  requireAccess,
} from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import { type Candidate, driveQuery } from "../drive-query.ts"
import {
  canSee,
  createFile,
  deleteFile,
  driveUser,
  type FileChange,
  fileOf,
  fileResource,
  FOLDER,
  isRoot,
  updateFile,
  writableFile,
  writableMetadata,
} from "../drive.ts"
import type { DriveFileRecord } from "../entities.ts"
import { withFields } from "../fields.ts"
import { openChannel } from "../push.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"

const FILES = "/drive/v3/files"

/** The fields Drive returns when a request names none. */
export const FILE_FIELDS = "kind,id,name,mimeType"

type File = drive_v3.Schema$File

/** What a `q` term is checked against, for one file. */
function candidateOf(
  context: GoogleRouteContext,
  caller: Caller,
  record: DriveFileRecord,
): Candidate {
  const users = googleStore(context.store).users
  const emails = (roles: readonly string[]) =>
    record.permissions.filter((p) => roles.includes(p.role ?? "")).map((p) => p.emailAddress ?? "")
  const content =
    record.content && !record.file.mimeType?.startsWith("image/")
      ? Buffer.from(record.content, "base64").toString("utf8")
      : ""

  return {
    file: record.file,
    text: `${record.file.name ?? ""} ${record.file.description ?? ""} ${content}`,
    ownerEmail: users.findOneBy("uid", record.owner)?.email ?? "",
    writers: emails(["writer", "organizer", "fileOrganizer"]),
    readers: emails(["reader", "commenter"]),
    sharedWithMe: record.owner !== caller.user.uid,
  }
}

/** The sort keys `orderBy` accepts, each as the text files are compared on. */
const SORT_KEYS: Readonly<Record<string, (file: File) => string>> = {
  folder: (file) => String(file.mimeType !== FOLDER),
  name: (file) => file.name ?? "",
  createdTime: (file) => file.createdTime ?? "",
  modifiedTime: (file) => file.modifiedTime ?? "",
  recency: (file) => file.modifiedTime ?? "",
  starred: (file) => String(file.starred !== true),
}

/** One `orderBy` key as a comparison of two files. */
function comparatorOf(key: string): (a: File, b: File) => number {
  const [field = "", direction] = key.trim().split(/\s+/)
  const sign = direction === "desc" ? -1 : 1
  const valueOf = SORT_KEYS[field]

  if (!valueOf) throw badRequest(`Invalid sort key: ${field}`, "invalid")

  return (a, b) => sign * valueOf(a).localeCompare(valueOf(b))
}

function ordered(files: File[], orderBy: string | undefined): File[] {
  if (!orderBy) return files

  const comparators = orderBy.split(",").map(comparatorOf)

  return files.toSorted((a, b) =>
    comparators.reduce((result, compare) => result || compare(a, b), 0),
  )
}

/** The parents a metadata update ends with, after `addParents` and `removeParents`. */
function parentsAfter(c: Context, file: File): string[] | undefined {
  const add = (c.req.query("addParents") ?? "").split(",").filter(Boolean)
  const remove = new Set((c.req.query("removeParents") ?? "").split(",").filter(Boolean))

  if (add.length === 0 && remove.size === 0) return undefined

  return [...(file.parents ?? []).filter((parent) => !remove.has(parent)), ...add]
}

/** The change a metadata update makes, for the file's watch channels. */
function changeOf(before: File, after: File): FileChange {
  if (after.trashed === true && before.trashed !== true) return { state: "trash" }
  if (after.trashed === false && before.trashed === true) return { state: "untrash" }

  return { state: "update", changed: before.parents === after.parents ? "properties" : "parents" }
}

/** Applies a metadata update (and optionally new content) from a request. */
export function applyUpdate(
  context: GoogleRouteContext,
  c: Context,
  record: DriveFileRecord,
  update: { readonly metadata: Record<string, unknown>; readonly content?: Buffer },
): DriveFileRecord {
  const parents = parentsAfter(c, record.file)
  const fields: File = {
    ...writableMetadata(update.metadata),
    ...(parents && { parents }),
    ...(update.metadata.trashed === true && { explicitlyTrashed: true }),
  }
  const next = { ...record.file, ...fields }
  const change: FileChange = update.content
    ? { state: "update", changed: "content" }
    : changeOf(record.file, next)

  return updateFile(
    context,
    record,
    { file: fields, ...(update.content && { content: update.content }) },
    change,
  )
}

/** Files: list, get (metadata or content), create, update, copy, delete, watch, and about. */
export function driveFileRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const respond = (c: Context, caller: Caller, record: DriveFileRecord) =>
    c.json(withFields(fileResource(context, caller, record), c.req.query("fields"), FILE_FIELDS))

  app.get(FILES, (c) => {
    const caller = requireAccess(c, context, SCOPES.driveRead)
    const test = driveQuery(c.req.query("q"))
    const files = googleStore(context.store)
      .files.all()
      .filter((record) => !isRoot(context, record))
      .filter(
        (record) => canSee(context, caller, record) && test(candidateOf(context, caller, record)),
      )
      .map((record) => fileResource(context, caller, record))
    const page = pageOf(
      ordered(files, c.req.query("orderBy")),
      c.req.query("pageToken"),
      pageSize(c, "pageSize", 100, 1000),
    )
    const body: drive_v3.Schema$FileList = {
      kind: "drive#fileList",
      incompleteSearch: false,
      files: page.items,
      ...(page.next && { nextPageToken: page.next }),
    }

    return c.json(
      withFields(
        body,
        c.req.query("fields"),
        `kind,incompleteSearch,nextPageToken,files(${FILE_FIELDS})`,
      ),
    )
  })

  app.get(`${FILES}/:fileId`, (c) => {
    const media = c.req.query("alt") === "media"
    const caller = requireAccess(c, context, media ? SCOPES.driveContent : SCOPES.driveRead)
    const record = fileOf(context, caller, c.req.param("fileId"))

    if (!media) return respond(c, caller, record)
    if (record.file.mimeType?.startsWith("application/vnd.google-apps."))
      throw new GoogleApiError(
        403,
        "fileNotDownloadable",
        "Only files with binary content can be downloaded. Use Export with Docs Editors files.",
      )

    return c.body(Buffer.from(record.content ?? "", "base64"), 200, {
      "content-type": record.file.mimeType ?? "application/octet-stream",
    })
  })

  app.post(FILES, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)

    return respond(
      c,
      caller,
      createFile(context, caller.user, caller.clientId, { metadata: await jsonBody(c) }),
    )
  })

  app.patch(`${FILES}/:fileId`, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)
    const record = writableFile(context, caller, c.req.param("fileId"))

    return respond(c, caller, applyUpdate(context, c, record, { metadata: await jsonBody(c) }))
  })

  app.post(`${FILES}/:fileId/copy`, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)
    const source = fileOf(context, caller, c.req.param("fileId"))
    const body = await jsonBody(c)
    const copy = createFile(context, caller.user, caller.clientId, {
      metadata: { ...source.file, name: `Copy of ${source.file.name ?? ""}`, ...body },
      ...(source.content !== null && { content: Buffer.from(source.content, "base64") }),
      ...(source.file.mimeType && { mediaType: source.file.mimeType }),
    })

    return respond(c, caller, copy)
  })

  app.delete(`${FILES}/:fileId`, (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)

    deleteFile(context, writableFile(context, caller, c.req.param("fileId")))

    return c.body(null, 204)
  })

  app.post(`${FILES}/:fileId/watch`, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveRead)
    const record = fileOf(context, caller, c.req.param("fileId"))
    const resourceUri = `https://www.googleapis.com/drive/v3/files/${record.fileId}?alt=json`

    return c.json(
      openChannel(context, await jsonBody(c), { kind: "file", fileId: record.fileId }, resourceUri),
    )
  })

  app.get("/drive/v3/about", (c) => {
    const caller = requireAccess(c, context, SCOPES.driveRead)
    const used = googleStore(context.store)
      .files.findBy("owner", caller.user.uid)
      .reduce((total, record) => total + Number(record.file.size ?? 0), 0)
    const about: drive_v3.Schema$About = {
      kind: "drive#about",
      user: driveUser(caller.user, true),
      storageQuota: {
        limit: "16106127360",
        usage: String(used),
        usageInDrive: String(used),
        usageInDriveTrash: "0",
      },
    }

    if (queryAll(c, "fields").length === 0)
      throw new GoogleApiError(
        400,
        "required",
        "The 'fields' parameter is required for this method.",
      )

    return c.json(withFields(about, c.req.query("fields"), "*"))
  })
}
