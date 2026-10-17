import type { gmail_v1 } from "googleapis"

import type { Context } from "../../http.ts"
import { GoogleApiError, isRecord, jsonBody } from "../api.ts"
import type { GoogleRouteContext } from "../context.ts"
import type { GmailLabelRecord } from "../entities.ts"
import { labelResource } from "../gmail-format.ts"
import { changeLabels, labelOf, mailboxOwner } from "../gmail.ts"
import { SCOPES } from "../scopes.ts"
import { googleStore } from "../store.ts"

const LABELS = "/gmail/v1/users/:userId/labels"

const text = (value: unknown) => (typeof value === "string" ? value : null)

function colorOf(value: unknown): GmailLabelRecord["color"] {
  if (!isRecord(value)) return null

  const { textColor, backgroundColor } = value

  return typeof textColor === "string" && typeof backgroundColor === "string"
    ? { textColor, backgroundColor }
    : null
}

/** The label fields a create, update or patch body sets. */
function labelFields(body: Record<string, unknown>): Partial<GmailLabelRecord> {
  const name = text(body.name)
  const color = colorOf(body.color)

  return {
    ...(name !== null && { name }),
    ...("messageListVisibility" in body && {
      messageListVisibility: text(body.messageListVisibility),
    }),
    ...("labelListVisibility" in body && { labelListVisibility: text(body.labelListVisibility) }),
    ...(color && { color }),
  }
}

function checkNameFree(context: GoogleRouteContext, owner: string, name: string, self?: string) {
  const taken = googleStore(context.store)
    .labels.findBy("owner", owner)
    .some((label) => label.labelId !== self && label.name.toLowerCase() === name.toLowerCase())

  if (taken) throw new GoogleApiError(409, "duplicate", "Label name exists or conflicts")
}

/** Labels: list, get with counts, create, update, patch and delete. */
export function gmailLabelRoutes(context: GoogleRouteContext): void {
  const { app } = context
  const labels = () => googleStore(context.store).labels

  app.get(LABELS, (c) => {
    const caller = mailboxOwner(c, context, [...SCOPES.gmailRead, ...SCOPES.gmailLabels])

    return c.json({
      labels: labels()
        .findBy("owner", caller.user.uid)
        .map((label) => labelResource(label)),
    } satisfies gmail_v1.Schema$ListLabelsResponse)
  })

  app.get(`${LABELS}/:id`, (c) => {
    const caller = mailboxOwner(c, context, [...SCOPES.gmailRead, ...SCOPES.gmailLabels])
    const label = labelOf(context, caller.user.uid, c.req.param("id"))
    const messages = googleStore(context.store).messages.findBy("owner", caller.user.uid)

    return c.json(labelResource(label, messages))
  })

  app.post(LABELS, async (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailLabels)
    const fields = labelFields(await jsonBody(c))

    if (!fields.name) throw new GoogleApiError(400, "invalidArgument", "Invalid label name")
    checkNameFree(context, caller.user.uid, fields.name)

    const label = labels().insert({
      labelId: `Label_${labels().findBy("owner", caller.user.uid).length + 1}`,
      owner: caller.user.uid,
      name: fields.name,
      type: "user",
      messageListVisibility: fields.messageListVisibility ?? null,
      labelListVisibility: fields.labelListVisibility ?? null,
      color: fields.color ?? null,
    })

    return c.json(labelResource(label))
  })

  const change = async (c: Context) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailLabels)
    const label = labelOf(context, caller.user.uid, c.req.param("id"))
    const fields = labelFields(await jsonBody(c))

    if (label.type === "system")
      throw new GoogleApiError(400, "invalidArgument", "Invalid update request")
    if (fields.name) checkNameFree(context, caller.user.uid, fields.name, label.labelId)

    return c.json(labelResource(labels().update(label.id, fields) ?? label))
  }

  app.put(`${LABELS}/:id`, change)
  app.patch(`${LABELS}/:id`, change)

  app.delete(`${LABELS}/:id`, (c) => {
    const caller = mailboxOwner(c, context, SCOPES.gmailLabels)
    const label = labelOf(context, caller.user.uid, c.req.param("id"))

    if (label.type === "system")
      throw new GoogleApiError(400, "invalidArgument", "Invalid delete request")

    for (const message of googleStore(context.store).messages.findBy("owner", caller.user.uid))
      if (message.labelIds.includes(label.labelId))
        changeLabels(context, message, [], [label.labelId])
    labels().delete(label.id)

    return c.body(null, 204)
  })
}
