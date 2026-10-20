import { randomUUID } from "node:crypto"

import type { Subscription } from "@microsoft/microsoft-graph-types"

import type { Context } from "../../http.ts"
import { type GraphPermission, grants } from "../access.ts"
import { type GraphCaller, graphCaller } from "../auth.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { driveOf } from "../drive.ts"
import type { MicrosoftUser, SubscriptionRecord, WatchedResource } from "../entities.ts"
import { graphError } from "../helpers.ts"
import { type JsonObject, jsonBody, oneOf, text } from "../input.ts"
import { findFolder } from "../mailbox.ts"

/** The longest a subscription may live, in minutes: Outlook resources and drives differ. */
const MAX_MINUTES: Readonly<Record<WatchedResource["kind"], number>> = {
  message: 10_080,
  event: 10_080,
  drive: 42_300,
}

const PERMISSION: Readonly<Record<WatchedResource["kind"], GraphPermission>> = {
  message: "Mail.Read",
  event: "Calendars.Read",
  drive: "Files.Read",
}

const OWNER = String.raw`(?:me|users/([^/]+))`
const RESOURCES: ReadonlyArray<{
  readonly pattern: RegExp
  readonly watch: (
    match: RegExpExecArray,
    context: MicrosoftRouteContext,
    user: MicrosoftUser,
  ) => WatchedResource | undefined
}> = [
  {
    pattern: new RegExp(`^${OWNER}/messages$`, "i"),
    watch: () => ({ kind: "message", folderId: null }),
  },
  {
    pattern: new RegExp(`^${OWNER}/mailfolders(?:\\('([^']+)'\\)|/([^/]+))/messages$`, "i"),
    watch: (m, context, user) => {
      const folder = findFolder(context, user.oid, m[2] ?? m[3] ?? "")

      return folder && { kind: "message", folderId: folder.graphId }
    },
  },
  { pattern: new RegExp(`^${OWNER}/events$`, "i"), watch: () => ({ kind: "event" }) },
  {
    pattern: new RegExp(`^(?:${OWNER}/drive|drives/[^/]+)/root$`, "i"),
    watch: (_m, context, user) => ({ kind: "drive", driveId: driveOf(context, user.oid).graphId }),
  },
]

/** What a resource path watches, if the emulator supports it and it is the caller's own. */
function watchedResource(
  context: MicrosoftRouteContext,
  user: MicrosoftUser,
  resource: string,
): WatchedResource | undefined {
  const path = resource.replace(/^\/+/, "")

  for (const { pattern, watch } of RESOURCES) {
    const match = pattern.exec(path)
    const named = match?.[1]

    if (!match) continue
    if (named && named !== user.oid && named.toLowerCase() !== user.email.toLowerCase())
      return undefined

    return watch(match, context, user)
  }

  return undefined
}

function subscriptionObject(subscription: SubscriptionRecord) {
  return {
    id: subscription.graphId,
    resource: subscription.resource,
    applicationId: subscription.clientId,
    changeType: subscription.changeTypes.join(","),
    clientState: subscription.clientState,
    notificationUrl: subscription.notificationUrl,
    expirationDateTime: subscription.expiresAt,
    creatorId: subscription.owner,
    latestSupportedTlsVersion: "v1_2",
    lifecycleNotificationUrl: null,
    includeResourceData: false,
  } satisfies Subscription
}

function invalid(
  c: Context,
  context: MicrosoftRouteContext,
  message: string,
  code = "InvalidRequest",
): Response {
  return graphError(c, context.clock, { status: 400, code, message })
}

/** Why an expiry is refused for this kind of resource, or `undefined` when it is fine. */
function expiryProblem(
  context: MicrosoftRouteContext,
  kind: WatchedResource["kind"],
  expires: string | undefined,
) {
  const at = Date.parse(expires ?? "")
  const now = context.clock().getTime()

  if (Number.isNaN(at)) return "expirationDateTime is required and must be a date-time."
  if (at <= now) return "Subscription expiration must be in the future."
  if (at - now > MAX_MINUTES[kind] * 60_000)
    return `Subscription expiration can only be ${MAX_MINUTES[kind]} minutes in the future.`

  return undefined
}

/**
 * Graph's validation handshake: before creating a subscription it posts a token to the
 * notification URL and expects it back as plain text with a 200, within ten seconds.
 */
async function validates(url: string): Promise<boolean> {
  const token = `Validation: Testing client application reachability for subscription Request-Id: ${randomUUID()}`
  const target = new URL(url)

  target.searchParams.set("validationToken", token)

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      signal: AbortSignal.timeout(10_000),
    })

    return response.status === 200 && (await response.text()) === token
  } catch {
    return false
  }
}

const CHANGE_TYPES = ["created", "updated", "deleted"] as const

function changeTypes(raw: string | undefined, kind: WatchedResource["kind"]) {
  const asked = (raw ?? "").split(",").map((t) => t.trim())
  const types = asked.flatMap((t) => oneOf(CHANGE_TYPES, t) ?? [])
  const valid = types.length > 0 && types.length === asked.length
  const driveOk = kind !== "drive" || types.every((t) => t === "updated")

  return valid && driveOk ? types : undefined
}

/** A subscription request that passed every check but the validation handshake. */
interface Checked {
  readonly resource: string
  readonly watches: WatchedResource
  readonly types: SubscriptionRecord["changeTypes"]
  readonly url: string
  readonly expiresAt: string
}

/** Checks a create request's resource, permission, change types and expiry. */
function check(
  c: Context,
  context: MicrosoftRouteContext,
  caller: GraphCaller,
  body: JsonObject,
): Checked | Response {
  const resource = text(body.resource) ?? ""
  const watches = watchedResource(context, caller.user, resource)

  if (!watches) return invalid(c, context, `Resource '${resource}' is not supported.`)
  if (!grants(caller.scope, PERMISSION[watches.kind]))
    return graphError(c, context.clock, {
      status: 403,
      code: "ExtensionError",
      message: "Operation: Create; Exception: [Status Code: Forbidden; Reason: Access is denied.]",
    })

  const types = changeTypes(text(body.changeType), watches.kind)
  const expires = text(body.expirationDateTime)
  const expiry = expiryProblem(context, watches.kind, expires)

  if (!types)
    return invalid(
      c,
      context,
      `ChangeType '${text(body.changeType) ?? ""}' is not supported for resource '${resource}'.`,
    )
  if (expiry) return invalid(c, context, expiry)

  const url = text(body.notificationUrl) ?? ""

  return {
    resource,
    watches,
    types,
    url,
    expiresAt: new Date(Date.parse(expires ?? "")).toISOString(),
  }
}

async function create(c: Context, context: MicrosoftRouteContext): Promise<Response> {
  const caller = graphCaller(c, context.microsoft(), context.clock)

  if (caller instanceof Response) return caller

  const body = await jsonBody(c)
  const checked = check(c, context, caller, body)

  if (checked instanceof Response) return checked
  if (!(await validates(checked.url)))
    return invalid(
      c,
      context,
      "Subscription validation request failed. Notification endpoint must respond with 200 OK to validation request.",
      "ValidationError",
    )

  const subscription = context.microsoft().subscriptions.insert({
    graphId: randomUUID(),
    owner: caller.user.oid,
    clientId: caller.clientId,
    resource: checked.resource,
    watches: checked.watches,
    changeTypes: checked.types,
    notificationUrl: checked.url,
    clientState: text(body.clientState) ?? null,
    expiresAt: checked.expiresAt,
  })

  return c.json(subscriptionObject(subscription), 201)
}

/** The caller's live subscription a path names, or Graph's 404. */
function ownSubscription(
  c: Context,
  context: MicrosoftRouteContext,
): SubscriptionRecord | Response {
  const caller = graphCaller(c, context.microsoft(), context.clock)

  if (caller instanceof Response) return caller

  const found = context.microsoft().subscriptions.findOneBy("graphId", c.req.param("id"))
  const live = found && Date.parse(found.expiresAt) > context.clock().getTime()

  return found && live && found.clientId === caller.clientId
    ? found
    : graphError(c, context.clock, {
        status: 404,
        code: "ResourceNotFound",
        message: `The object was not found.`,
      })
}

/** Change notification subscriptions: create (after the validation handshake), list, renew, delete. */
export function subscriptionRoutes(context: MicrosoftRouteContext): void {
  context.app.post("/v1.0/subscriptions", (c) => create(c, context))

  context.app.get("/v1.0/subscriptions", (c) => {
    const caller = graphCaller(c, context.microsoft(), context.clock)

    if (caller instanceof Response) return caller

    const now = context.clock().getTime()
    const mine = context
      .microsoft()
      .subscriptions.all()
      .filter((s) => s.clientId === caller.clientId && Date.parse(s.expiresAt) > now)

    return c.json({
      "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#subscriptions",
      value: mine.map(subscriptionObject),
    })
  })

  context.app.get("/v1.0/subscriptions/:id", (c) => {
    const found = ownSubscription(c, context)

    return found instanceof Response ? found : c.json(subscriptionObject(found))
  })

  context.app.patch("/v1.0/subscriptions/:id", async (c) => {
    const found = ownSubscription(c, context)

    if (found instanceof Response) return found

    const expires = text((await jsonBody(c)).expirationDateTime)
    const problem = expiryProblem(context, found.watches.kind, expires)

    if (problem) return invalid(c, context, problem)

    const renewed = context.microsoft().subscriptions.update(found.id, {
      expiresAt: new Date(Date.parse(expires ?? "")).toISOString(),
    })

    return c.json(subscriptionObject(renewed ?? found))
  })

  context.app.delete("/v1.0/subscriptions/:id", (c) => {
    const found = ownSubscription(c, context)

    if (found instanceof Response) return found
    context.microsoft().subscriptions.delete(found.id)

    return c.body(null, 204)
  })
}
