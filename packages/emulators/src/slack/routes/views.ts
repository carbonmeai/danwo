import { createHash } from "node:crypto"

import type { ApiCall, Methods } from "../context.ts"
import type { ViewRecord } from "../entities.ts"
import { viewObject } from "../formatters.ts"
import { asObject, jsonArg, requireArg, SlackApiError, slackId, stringArg } from "../helpers.ts"
import { appOf, requireUser, teamOf } from "../lookup.ts"

/** A view's hash: changes whenever the view does, as `views.update` compares it. */
export const hashOf = (view: Record<string, unknown>, at: string) =>
  `${at.replaceAll(/\D/g, "").slice(0, 10)}.${createHash("sha1").update(JSON.stringify(view)).digest("hex").slice(0, 8)}`

/** A view's place and state when it is first shown: the root of its own stack, open, no errors. */
export const NEW_VIEW = { rootViewId: null, previousViewId: null, errors: null, closed: false }

/** The `view` argument, which must be an object with a `type`. */
function viewArg(call: ApiCall, type?: string): Record<string, unknown> {
  const view = asObject(jsonArg(call.args, "view"))

  if (!view || typeof view.type !== "string") throw new SlackApiError("invalid_arguments")
  if (type !== undefined && view.type !== type) throw new SlackApiError("invalid_arguments")

  return view
}

/** A trigger the caller may use: known, not used yet and less than three seconds old. */
function consumeTrigger(call: ApiCall): string {
  const { slack, clock } = call.context
  const trigger = slack.triggers.findOneBy(
    "triggerId",
    requireArg(call.args, "trigger_id", "invalid_trigger_id"),
  )

  if (!trigger || trigger.appId !== call.token.appId) throw new SlackApiError("invalid_trigger_id")
  if (trigger.used) throw new SlackApiError("exchanged_trigger_id")
  if (trigger.expiresAt < clock().getTime()) throw new SlackApiError("expired_trigger_id")
  slack.triggers.update(trigger.id, { used: true })

  return trigger.user
}

function answer(call: ApiCall, view: ViewRecord) {
  const team = teamOf(call.context.slack).teamId

  return {
    view: viewObject(view, team, appOf(call.context.slack, call.token.appId).install?.botId ?? ""),
  }
}

function openMethod(call: ApiCall) {
  const user = consumeTrigger(call)
  const view = viewArg(call, "modal")
  const record = call.context.slack.views.insert({
    viewId: slackId("V"),
    appId: call.token.appId,
    user,
    externalId: typeof view.external_id === "string" ? view.external_id : null,
    hash: hashOf(view, call.context.clock().toISOString()),
    view,
    ...NEW_VIEW,
  })

  return answer(call, record)
}

/** The view `views.update` names, by `view_id` or `external_id`. */
function namedView(call: ApiCall): ViewRecord {
  const { slack } = call.context
  const viewId = stringArg(call.args, "view_id")
  const externalId = stringArg(call.args, "external_id")
  const found =
    viewId === undefined
      ? slack.views.findOneBy("externalId", externalId ?? "")
      : slack.views.findOneBy("viewId", viewId)

  if (!found || found.appId !== call.token.appId) throw new SlackApiError("not_found")

  return found
}

function updateMethod(call: ApiCall) {
  const current = namedView(call)
  const hash = stringArg(call.args, "hash")

  if (hash !== undefined && hash !== current.hash) throw new SlackApiError("hash_conflict")

  const view = viewArg(call)
  const updated =
    call.context.slack.views.update(current.id, {
      view,
      hash: hashOf(view, call.context.clock().toISOString()),
    }) ?? current

  return answer(call, updated)
}

function publishMethod(call: ApiCall) {
  const { slack } = call.context
  const user = requireUser(slack, requireArg(call.args, "user_id", "user_not_found")).userId
  const view = viewArg(call, "home")
  const hash = hashOf(view, call.context.clock().toISOString())
  const existing = slack.views
    .all()
    .find(
      (candidate) =>
        candidate.appId === call.token.appId &&
        candidate.user === user &&
        candidate.view.type === "home",
    )
  const record = existing
    ? (slack.views.update(existing.id, { view, hash }) ?? existing)
    : slack.views.insert({
        viewId: slackId("V"),
        appId: call.token.appId,
        user,
        externalId: null,
        hash,
        view,
        ...NEW_VIEW,
      })

  return answer(call, record)
}

/** `views.open`, `views.update` and `views.publish`. */
export const viewMethods: Methods = {
  "views.open": { scopes: [], run: openMethod },
  "views.update": { scopes: [], run: updateMethod },
  "views.publish": { scopes: [], run: publishMethod },
}
