import type { Outbox } from "../outbox.ts"
import type { Clock } from "../store.ts"
import type { AuthConfigRecord, ConnectedAccountRecord, TriggerInstanceRecord } from "./entities.ts"
import { connectedAccountObject } from "./formatters.ts"
import { composioId } from "./helpers.ts"

/** The webhook event types a subscription can enable. */
export const EVENT_TYPES = {
  trigger: "composio.trigger.message",
  expired: "composio.connected_account.expired",
} as const

/** The project the emulator stands in for, as events name it. */
const PROJECT = { project_id: "pr_danwoEmulated", org_id: "ok_danwoEmulated" } as const

/** Queues Composio's webhook events, in the V3 shape the SDK's `verifyWebhook` parses. */
export class ComposioEvents {
  private readonly outbox: Outbox
  private readonly clock: Clock

  constructor(outbox: Outbox, clock: Clock) {
    this.outbox = outbox
    this.clock = clock
  }

  /** A trigger fired: `data` is the toolkit's payload for it. */
  trigger(
    trigger: TriggerInstanceRecord,
    account: ConnectedAccountRecord,
    data: Readonly<Record<string, unknown>>,
  ): void {
    this.outbox.push(EVENT_TYPES.trigger, {
      id: composioId("msg", 16),
      timestamp: this.clock().toISOString(),
      type: EVENT_TYPES.trigger,
      metadata: {
        log_id: composioId("log"),
        trigger_slug: trigger.triggerName,
        trigger_id: trigger.id,
        connected_account_id: account.id,
        auth_config_id: account.authConfigId,
        user_id: account.userId,
      },
      data: { ...data },
    })
  }

  /** An account's credentials stopped working and could not be refreshed. */
  expired(account: ConnectedAccountRecord, config: AuthConfigRecord | undefined): void {
    this.outbox.push(EVENT_TYPES.expired, {
      id: composioId("msg", 16),
      timestamp: this.clock().toISOString(),
      type: EVENT_TYPES.expired,
      metadata: { ...PROJECT },
      data: connectedAccountObject(account, config),
    })
  }
}
