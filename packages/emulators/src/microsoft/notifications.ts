import type { ChangeNotification } from "@microsoft/microsoft-graph-types"

import type { WebhookEndpoint } from "../webhooks.ts"
import type { GraphState } from "./context.ts"
import type { ChangeRecord, SubscriptionRecord } from "./entities.ts"
import type { MicrosoftStore } from "./store.ts"

/** Whether a subscription watches the item a change is about. */
function watches(subscription: SubscriptionRecord, change: ChangeRecord): boolean {
  const watched = subscription.watches

  if (watched.kind !== change.kind) return false
  if (watched.kind === "message")
    return watched.folderId === null || watched.folderId === change.folderId
  if (watched.kind === "drive") return watched.driveId === change.folderId

  return true
}

/** The change type a subscription is told: drives only ever report `updated`, on their root. */
function reportedType(subscription: SubscriptionRecord, change: ChangeRecord) {
  return subscription.watches.kind === "drive" ? "updated" : change.changeType
}

const ODATA_TYPES = { message: "#Microsoft.Graph.Message", event: "#Microsoft.Graph.Event" }
const SEGMENTS = { message: "Messages", event: "Events" }

/** One change notification, as Graph posts it inside `value`. */
function notification(
  subscription: SubscriptionRecord,
  change: ChangeRecord,
  tenantId: string,
): ChangeNotification {
  const base = {
    subscriptionId: subscription.graphId,
    subscriptionExpirationDateTime: subscription.expiresAt,
    changeType: reportedType(subscription, change),
    clientState: subscription.clientState,
    tenantId,
  }

  if (change.kind === "drive") return { ...base, resource: subscription.resource }

  const resource = `Users/${change.owner}/${SEGMENTS[change.kind]}/${change.targetId}`

  return {
    ...base,
    resource,
    resourceData: {
      "@odata.type": ODATA_TYPES[change.kind],
      "@odata.id": resource,
      id: change.targetId,
    },
  }
}

function live(subscription: SubscriptionRecord, now: Date): boolean {
  return Date.parse(subscription.expiresAt) > now.getTime()
}

/** Queues a notification for every live subscription that watches the change. */
export function notifySubscribers(state: GraphState, change: ChangeRecord): void {
  const microsoft = state.microsoft()
  const tenantId = microsoft.users.findOneBy("oid", change.owner)?.tenant_id ?? ""

  for (const subscription of microsoft.subscriptions.all()) {
    const wanted = subscription.changeTypes.includes(reportedType(subscription, change))

    if (
      subscription.owner === change.owner &&
      wanted &&
      live(subscription, state.clock()) &&
      watches(subscription, change)
    )
      state.outbox.push(subscription.graphId, {
        value: [notification(subscription, change, tenantId)],
      })
  }
}

/** Each live subscription as a webhook endpoint that receives only its own notifications. */
export function subscriptionEndpoints(microsoft: MicrosoftStore): WebhookEndpoint[] {
  return microsoft.subscriptions.all().map((subscription) => ({
    id: subscription.graphId,
    url: subscription.notificationUrl,
    events: [subscription.graphId],
    secret: subscription.clientState ?? "",
    enabled: true,
  }))
}
