import type { Context } from "../../http.ts"
import { changesSince, decodeToken, encodeToken, latestChange } from "../changes.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { deletedItemObject, driveItemObject } from "../drive-formatters.ts"
import { graphError } from "../helpers.ts"
import { pageSize, withParam } from "../odata.ts"
import { type DriveAction, type DriveRequest, notFound } from "./drive-request.ts"

/** Graph's answer to a delta token it cannot resume from: start over. */
function resyncRequired(c: Context, context: MicrosoftRouteContext): Response {
  return graphError(c, context.clock, {
    status: 410,
    code: "resyncRequired",
    message:
      "Resync required. Replace any local items with the server's version (including deletes) if you're sure that the service was up to date with your local changes when you last sync'd. Upload any local changes that the server doesn't know about.",
  })
}

/** The URL of the next delta page or round, carrying `state` as its token. */
function link(c: Context, state: Readonly<Record<string, string | number>>): string {
  const url = new URL(c.req.url)

  return withParam(`${url.origin}${url.pathname}`, "token", encodeToken(state))
}

/** The first round: every item in the drive, root first, a page at a time. */
function firstRound(
  c: Context,
  context: MicrosoftRouteContext,
  request: DriveRequest,
  since: number,
  offset: number,
) {
  const all = context.microsoft().items.findBy("driveId", request.drive.graphId)
  const ordered = all.toSorted((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null))
  const size = pageSize(c, 200)
  const value = ordered
    .slice(offset, offset + size)
    .map((i) => driveItemObject(context, request.drive, i))
  const next = offset + size
  const state = { d: request.drive.graphId, s: since }

  return c.json(
    next < ordered.length
      ? { value, "@odata.nextLink": link(c, { ...state, o: next }) }
      : { value, "@odata.deltaLink": link(c, state) },
  )
}

/** A later round: items changed since the token, and deleted ones marked as such. */
function changes(c: Context, context: MicrosoftRouteContext, request: DriveRequest, since: number) {
  const items = context.microsoft().items
  const value = changesSince(context, {
    owner: request.drive.owner,
    kind: "drive",
    since,
    where: (change) => change.folderId === request.drive.graphId,
  }).map((change) => {
    const item = items.findOneBy("graphId", change.targetId)

    return item
      ? driveItemObject(context, request.drive, item)
      : deletedItemObject(request.drive, change.targetId)
  })

  return c.json({
    value,
    "@odata.deltaLink": link(c, { d: request.drive.graphId, s: latestChange(context) }),
  })
}

/**
 * The drive's delta from its root: a first round of every item, then each round what changed
 * since the last link's token. `token=latest` skips the first round.
 */
export const driveDelta: DriveAction = (c, context, request) => {
  if (request.item?.parentId !== null) return notFound(c, context)

  const raw = c.req.query("token")

  if (raw === undefined) return firstRound(c, context, request, latestChange(context), 0)
  if (raw === "latest")
    return c.json({
      value: [],
      "@odata.deltaLink": link(c, { d: request.drive.graphId, s: latestChange(context) }),
    })

  const token = decodeToken(raw)

  if (token?.d !== request.drive.graphId || typeof token.s !== "number")
    return resyncRequired(c, context)
  if (token.o !== undefined) return firstRound(c, context, request, token.s, Number(token.o) || 0)

  return changes(c, context, request, token.s)
}
