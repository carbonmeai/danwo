import type { drive_v3 } from "googleapis"

import { badRequest, type Caller, jsonBody, notFound, pageSize, requireAccess } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import {
  addPermission,
  canSee,
  fileOf,
  fileResource,
  permissionsOf,
  recordChange,
  writableFile,
} from "../drive.ts"
import type { DriveChangeRecord } from "../entities.ts"
import { withFields } from "../fields.ts"
import { openChannel, stopChannel } from "../push.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"
import { FILE_FIELDS } from "./drive-files.ts"

const PERMISSIONS = "/drive/v3/files/:fileId/permissions"
const PERMISSION_FIELDS = "kind,id,type,role,emailAddress"
const CHANGE_FIELDS = `kind,nextPageToken,newStartPageToken,changes(kind,changeType,type,time,removed,fileId,file(${FILE_FIELDS}))`

const ROLES = new Set(["owner", "organizer", "fileOrganizer", "writer", "commenter", "reader"])
const TYPES = new Set(["user", "group", "domain", "anyone"])

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

/** Drive's 400 for a role or type it does not know, or a user or group without an address. */
function checkPermission(role: string, type: string, emailAddress: string | undefined): void {
  if (!ROLES.has(role) || !TYPES.has(type))
    throw badRequest("Invalid permission role or type.", "invalid")
  if ((type === "user" || type === "group") && !emailAddress)
    throw badRequest("The permission's email address is required.", "required")
}

/** The permission a create body asks for, or Drive's 400. */
function permissionFrom(body: Record<string, unknown>): drive_v3.Schema$Permission {
  const role = text(body.role) ?? ""
  const type = text(body.type) ?? ""
  const emailAddress = text(body.emailAddress)?.toLowerCase()
  const domain = text(body.domain)

  checkPermission(role, type, emailAddress)

  return { role, type, ...(emailAddress && { emailAddress }), ...(domain && { domain }) }
}

/** The latest change per file at or after `start` that `caller` can see, in order. */
function changesFrom(
  context: GoogleRouteContext,
  caller: Caller,
  start: number,
): DriveChangeRecord[] {
  const latest = new Map<string, DriveChangeRecord>()

  for (const change of googleStore(context.store).changes.all())
    if (change.id >= start && change.viewers.includes(caller.user.uid)) {
      latest.delete(change.fileId)
      latest.set(change.fileId, change)
    }

  return [...latest.values()]
}

/** Permissions, the change feed and stopping channels. */
export function driveSharingRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const files = () => googleStore(context.store).files

  app.get(PERMISSIONS, (c) => {
    const caller = requireAccess(c, context, SCOPES.driveRead)
    const record = fileOf(context, caller, c.req.param("fileId"))
    const body: drive_v3.Schema$PermissionList = {
      kind: "drive#permissionList",
      permissions: permissionsOf(context, record),
    }

    return c.json(withFields(body, c.req.query("fields"), `kind,permissions(${PERMISSION_FIELDS})`))
  })

  app.post(PERMISSIONS, async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)
    const record = writableFile(context, caller, c.req.param("fileId"))
    const permission = addPermission(context, record, permissionFrom(await jsonBody(c)))

    return c.json(withFields(permission, c.req.query("fields"), PERMISSION_FIELDS))
  })

  app.delete(`${PERMISSIONS}/:permissionId`, (c) => {
    const caller = requireAccess(c, context, SCOPES.driveWrite)
    const record = writableFile(context, caller, c.req.param("fileId"))
    const remaining = record.permissions.filter(
      (permission) => permission.id !== c.req.param("permissionId"),
    )

    if (remaining.length === record.permissions.length)
      throw notFound(`Permission not found: ${c.req.param("permissionId")}.`)

    recordChange(context, record, { state: "update", changed: "permissions" })
    files().update(record.id, { permissions: remaining })

    return c.body(null, 204)
  })

  app.get("/drive/v3/changes/startPageToken", (c) => {
    requireAccess(c, context, SCOPES.driveRead)

    const last = googleStore(context.store).changes.all().at(-1)?.id ?? 0

    return c.json({
      kind: "drive#startPageToken",
      startPageToken: String(last + 1),
    } satisfies drive_v3.Schema$StartPageToken)
  })

  app.get("/drive/v3/changes", (c) => {
    const caller = requireAccess(c, context, SCOPES.driveRead)
    const start = Number(c.req.query("pageToken"))

    if (!Number.isInteger(start) || start < 1) throw badRequest("Invalid Value", "invalid")

    const all = changesFrom(context, caller, start)
    const size = pageSize(c, "pageSize", 100, 1000)
    const page = all.slice(0, size)
    const last = googleStore(context.store).changes.all().at(-1)?.id ?? 0
    const body: drive_v3.Schema$ChangeList = {
      kind: "drive#changeList",
      changes: page.map((change) => {
        const record = files().findOneBy("fileId", change.fileId)
        const visible = record && canSee(context, caller, record)

        return {
          kind: "drive#change",
          changeType: "file",
          type: "file",
          time: change.created_at,
          removed: change.removed || !visible,
          fileId: change.fileId,
          ...(visible && { file: fileResource(context, caller, record) }),
        }
      }),
      ...(all.length > size
        ? { nextPageToken: String((page.at(-1)?.id ?? last) + 1) }
        : { newStartPageToken: String(last + 1) }),
    }

    return c.json(withFields(body, c.req.query("fields"), CHANGE_FIELDS))
  })

  app.post("/drive/v3/changes/watch", async (c) => {
    const caller = requireAccess(c, context, SCOPES.driveRead)
    const resourceUri = `https://www.googleapis.com/drive/v3/changes?alt=json&pageToken=${c.req.query("pageToken") ?? ""}`

    return c.json(
      openChannel(
        context,
        await jsonBody(c),
        { kind: "changes", owner: caller.user.uid },
        resourceUri,
      ),
    )
  })

  app.post("/drive/v3/channels/stop", (c) => stopChannel(c, context.store))
}
