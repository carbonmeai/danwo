import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks"
import type { NextRequest } from "next/server"

import {
  recordMembership,
  recordUser,
  removeMembership,
  removeUser,
} from "../../../../lib/accounts.ts"
import { broken } from "../../../../lib/bugs.ts"

/** Whether a parsed body has an event's shape: a type and its data. */
function isEvent(value: unknown): value is WebhookEvent {
  const type: unknown = Reflect.get(Object(value), "type")
  const data: unknown = Reflect.get(Object(value), "data")

  return typeof type === "string" && typeof data === "object" && data !== null
}

/**
 * The event a delivery carries, once its Svix signature checks out against
 * `CLERK_WEBHOOK_SIGNING_SECRET` and its timestamp is recent; undefined for a forged or replayed
 * one. With the `no-webhook-verify` bug on, any body that looks like an event is believed.
 */
async function eventOf(request: NextRequest): Promise<WebhookEvent | undefined> {
  if (broken("no-webhook-verify")) {
    const body: unknown = await request.json().catch(() => undefined)

    return isEvent(body) ? body : undefined
  }

  return verifyWebhook(request).catch(() => undefined)
}

/** Brings the app's records in line with one event. Every write is safe to repeat. */
async function apply(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case "user.created":
    case "user.updated":
      return recordUser(event.data)
    case "user.deleted":
      return event.data.id === undefined ? undefined : removeUser(event.data.id)
    case "organizationMembership.created":
    case "organizationMembership.updated":
      return recordMembership(event.data)
    case "organizationMembership.deleted":
      return removeMembership(event.data.id)
    default:
      return undefined
  }
}

/**
 * Clerk's webhook. A delivery whose signature does not check out is refused with 400 and changes
 * nothing. A genuine one is applied; if the database fails even after retries the answer is 500,
 * and Clerk delivers the event again later. A duplicate or late delivery is answered 200 like any.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const event = await eventOf(request)

  if (event === undefined) return Response.json({ error: "invalid signature" }, { status: 400 })

  try {
    await apply(event)
  } catch (error) {
    console.error(`could not apply ${event.type}`, error)

    return Response.json({ error: "try again" }, { status: 500 })
  }

  return Response.json({ received: true })
}
