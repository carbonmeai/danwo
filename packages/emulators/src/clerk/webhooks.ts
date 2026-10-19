import type {
  DeletedObjectJSON,
  OrganizationJSON,
  OrganizationMembershipJSON,
  SessionJSON,
  UserDeletedJSON,
} from "@clerk/backend"

import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import { svixHeaders } from "../svix.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import type { ClerkUser } from "./entities.ts"
import { stableClerkId } from "./helpers.ts"
import { clerkStore, INSTANCE } from "./store.ts"

/** The event types the emulator sends. */
export type ClerkEventType =
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "session.created"
  | "session.ended"
  | "session.removed"
  | "session.revoked"
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "organizationMembership.created"
  | "organizationMembership.updated"
  | "organizationMembership.deleted"

/** The `data` of each event type. */
interface EventData {
  user: ClerkUser
  userDeleted: UserDeletedJSON
  session: SessionJSON & { user: ClerkUser | null }
  organization: OrganizationJSON
  deleted: DeletedObjectJSON
  membership: OrganizationMembershipJSON
}

/**
 * Queues Clerk's webhook events, shaped as Clerk sends them: `{type, object: "event", data,
 * event_attributes, timestamp, instance_id}`, with `timestamp` in milliseconds.
 */
export class ClerkEvents {
  private readonly store: Store
  private readonly outbox: Outbox
  private readonly clock: Clock
  private muted = false

  constructor(store: Store, outbox: Outbox, clock: Clock) {
    this.store = store
    this.outbox = outbox
    this.clock = clock
  }

  /** Runs `work` sending no events, as seeding does unless it is asked to announce its records. */
  // fallow-ignore-next-line unused-class-member -- called through the emulator's context
  quietly(work: () => void): void {
    this.muted = true

    try {
      work()
    } finally {
      this.muted = false
    }
  }

  user(type: "user.created" | "user.updated", user: ClerkUser): void {
    this.push(type, user)
  }

  userDeleted(user: ClerkUser): void {
    const data: EventData["userDeleted"] = {
      object: "user",
      id: user.id,
      deleted: true,
      ...(user.external_id !== null && { external_id: user.external_id }),
    }

    this.push("user.deleted", data)
  }

  session(
    type: "session.created" | "session.ended" | "session.removed" | "session.revoked",
    session: SessionJSON,
  ): void {
    const user = clerkStore(this.store).users.get(session.user_id) ?? null
    const data: EventData["session"] = { ...session, user }

    this.push(type, data)
  }

  organization(type: "organization.created" | "organization.updated", org: OrganizationJSON): void {
    this.push(type, org)
  }

  organizationDeleted(id: string): void {
    const data: EventData["deleted"] = { object: "organization", id, deleted: true }

    this.push("organization.deleted", data)
  }

  membership(
    type:
      | "organizationMembership.created"
      | "organizationMembership.updated"
      | "organizationMembership.deleted",
    membership: OrganizationMembershipJSON,
  ): void {
    this.push(type, membership)
  }

  private push(type: ClerkEventType, data: EventData[keyof EventData]): void {
    if (this.muted) return

    const instance = this.store.getData(INSTANCE)
    const event = {
      type,
      object: "event",
      data,
      event_attributes: { http_request: { client_ip: "", user_agent: "" } },
      timestamp: this.clock().getTime(),
      instance_id: stableClerkId("ins", instance?.slug ?? ""),
    }

    this.outbox.push(type, event)
  }
}

/** An endpoint Clerk delivers webhooks to, with its `whsec_` signing secret. */
export interface ClerkWebhookRecord {
  readonly id: string
  readonly url: string
  /** Event types it subscribes to; empty means every event. */
  readonly events: readonly string[]
  readonly secret: string
  readonly enabled: boolean
  /** Custom headers sent with every delivery, as a Svix endpoint can be set to add. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Where the emulator's webhooks go. */
export function clerkEndpoints(store: Store): WebhookEndpoint[] {
  return clerkStore(store)
    .webhooks.all()
    .map((hook) => ({
      id: hook.id,
      url: hook.url,
      events: hook.events.length > 0 ? hook.events : ["*"],
      secret: hook.secret,
      enabled: hook.enabled,
    }))
}

/**
 * The headers of one delivery: the endpoint's custom headers, then Svix's as Clerk sends them
 * (`svix-id`, `svix-timestamp`, `svix-signature`), which a custom header cannot replace.
 */
export function clerkWebhookHeaders(
  secret: string,
  body: string,
  timestamp: number,
  custom: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...custom, ...svixHeaders(secret, body, timestamp, "svix") }
}

/** The custom headers of the endpoint a delivery goes to, if it has any. */
export function clerkCustomHeaders(
  store: Store,
  endpointId: string,
): Readonly<Record<string, string>> {
  return clerkStore(store).webhooks.get(endpointId)?.headers ?? {}
}
