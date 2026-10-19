/** What tests read from and do to a Novu emulator besides calling its API. */
import type { Emulator } from "../define.ts"
import { waitUntil } from "../poll.ts"
import type { Store } from "../store.ts"
import type { NovuEngine } from "./engine.ts"
import type { NovuChannel, NovuExecution, NovuMessage, NovuSubscriber } from "./entities.ts"
import type { NovuRealtime } from "./realtime.ts"
import { novuStore } from "./store.ts"

const SERVERS = new WeakMap<Store, { engine: NovuEngine; realtime: NovuRealtime }>()

export function registerNovu(store: Store, engine: NovuEngine, realtime: NovuRealtime): void {
  SERVERS.set(store, { engine, realtime })
}

export function novuServer(store: Store): { engine: NovuEngine; realtime: NovuRealtime } {
  const found = SERVERS.get(store)

  if (found === undefined) throw new Error("not a Novu emulator")

  return found
}

/** A Novu emulator's workflows, messages and Inboxes as tests read them. */
export interface NovuProject {
  /** Every subscriber, oldest first. */
  subscribers(): NovuSubscriber[]
  /** Every workflow run, oldest first, with each step's status and outputs. */
  executions(filter?: { workflowId?: string; subscriberId?: string }): NovuExecution[]
  /** Messages the workflows sent, oldest first, by channel and subscriber. */
  messages(filter?: {
    channel?: NovuChannel
    subscriberId?: string
    workflowId?: string
  }): NovuMessage[]
  /** A subscriber's Inbox: in-app messages not archived, newest first. */
  inbox(subscriberId: string): NovuMessage[]
  /** Waits up to `timeoutMs` (10 s by default) for a message on `channel` to `subscriberId`. */
  waitForMessage(
    subscriberId: string,
    options?: { channel?: NovuChannel; timeoutMs?: number },
  ): Promise<NovuMessage>
  /** Waits until every workflow run started so far has finished. */
  idle(): Promise<void>
  /** How many Inboxes each subscriber has open on the realtime socket. */
  openInboxes(): Record<string, number>
}

/** A Novu emulator's project: subscribers, workflow runs, messages sent and open Inboxes. */
export function novuProject(emulator: Pick<Emulator, "store">): NovuProject {
  const objects = novuStore(emulator.store)
  const messages = (filter: Parameters<NovuProject["messages"]>[0] = {}) =>
    objects.messages.where(
      (m) =>
        (filter.channel === undefined || m.channel === filter.channel) &&
        (filter.subscriberId === undefined || m.subscriber_id === filter.subscriberId) &&
        (filter.workflowId === undefined || m.workflow_id === filter.workflowId),
    )

  return {
    subscribers: () => objects.subscribers.all(),
    executions: (filter = {}) =>
      objects.executions.where(
        (e) =>
          (filter.workflowId === undefined || e.workflow_id === filter.workflowId) &&
          (filter.subscriberId === undefined || e.subscriber_id === filter.subscriberId),
      ),
    messages,
    inbox: (subscriberId) =>
      messages({ channel: "in_app", subscriberId })
        .filter((m) => !m.archived)
        .toReversed(),
    waitForMessage: (subscriberId, options = {}) =>
      waitUntil(
        () => messages({ subscriberId, channel: options.channel ?? "in_app" }).at(-1),
        options.timeoutMs ?? 10_000,
        `no Novu ${options.channel ?? "in_app"} message to ${subscriberId}`,
      ),
    idle: () => novuServer(emulator.store).engine.idle(),
    openInboxes: () => novuServer(emulator.store).realtime.inboxes(),
  }
}
