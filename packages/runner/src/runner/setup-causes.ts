/**
 * What a test's setup set off that only arrived once its body began. A saved session signing in,
 * a fixture or a `beforeEach` may make a provider emit a webhook that is delivered seconds later,
 * the app's handler may call providers and write rows while answering it, and a transaction
 * setup opened may still be running. Counted as the body's, those get planned faults that never
 * fire in trials that skip the setup (a restored sign-in), so they are found here by what caused
 * them, not by when they came:
 *
 * - a delivery of a message the provider had emitted before the body began;
 * - a call or statement the app made on its server while it answered such a delivery;
 * - a statement on a connection whose transaction setup opened, until that transaction ends.
 */
import type { DataCall } from "@danwo/infra"
import {
  type RunWebhooks,
  type ServiceDelivery,
  type SetupCaused,
  type SetupSpan,
  webhookSources,
} from "@danwo/matrix"
import type { Exchange } from "@danwo/proxy"

/** By webhook service (`""` for an unnamed dispatcher), the newest message id emitted so far. */
export type MessageMarks = Readonly<Record<string, number>>

/** Every dispatcher's newest message id, read when the body begins. */
export function messageMarks(webhooks: RunWebhooks | undefined): MessageMarks {
  return Object.fromEntries(
    webhookSources(webhooks).map(([service, dispatcher]) => [
      service ?? "",
      dispatcher.lastMessageId(),
    ]),
  )
}

/** What a run made, from its start, as a trial reports it. */
export interface RunLists {
  readonly exchanges: readonly Pick<Exchange, "startedAt" | "client">[]
  readonly deliveries: readonly ServiceDelivery[]
  readonly dataCalls: readonly DataCall[]
}

/** When a delivery was being answered, by the wall clock: [sent, answered]. */
type Window = readonly [number, number]

function within(windows: readonly Window[], at: string): boolean {
  const time = Date.parse(at)

  return windows.some(([sent, answered]) => time >= sent && time <= answered)
}

const ENDS_TRANSACTION = new Set(["COMMIT", "ROLLBACK", "END", "ABORT"])
const STARTS_TRANSACTION = new Set(["BEGIN", "START"])

/** Whether a transaction is open on the connection after `call`. */
function openAfter(call: DataCall, open: boolean): boolean {
  if (STARTS_TRANSACTION.has(call.verb)) return true
  if (ENDS_TRANSACTION.has(call.verb)) return false

  return open || call.inTransaction
}

/**
 * The body's statements setup set off: those on a connection whose transaction setup opened,
 * until it commits or rolls back (that statement included), and those sent while a delivery
 * setup set off was being answered. A service's first `skip[service]` statements are setup's.
 */
function causedStatements(
  calls: readonly DataCall[],
  skip: Readonly<Record<string, number>>,
  windows: readonly Window[],
): number[] {
  const seen = new Map<string, number>()
  const open = new Map<string, boolean>()
  const caused: number[] = []

  calls.forEach((call, index) => {
    const at = seen.get(call.service) ?? 0
    const connection = `${call.service}#${call.connection}`
    const wasOpen = open.get(connection) ?? false

    seen.set(call.service, at + 1)

    if (at < (skip[call.service] ?? 0)) open.set(connection, openAfter(call, wasOpen))
    else if (wasOpen) {
      caused.push(index)
      open.set(connection, call.inTransaction && !ENDS_TRANSACTION.has(call.verb))
    } else if (within(windows, call.startedAt)) caused.push(index)
  })

  return caused
}

/** When each delivery at `indexes` was being answered, for those that say when they were sent. */
function answering(deliveries: readonly ServiceDelivery[], indexes: readonly number[]): Window[] {
  return indexes.flatMap((index): Window[] => {
    const delivery = deliveries[index]
    const sent = Date.parse(delivery?.sentAt ?? "")

    return delivery === undefined || Number.isNaN(sent) ? [] : [[sent, sent + delivery.durationMs]]
  })
}

/**
 * What setup set off among the body's calls, deliveries and statements, by their indexes in
 * `run`. `setup` says where the body began in each list; `messages` is each dispatcher's newest
 * message id at that moment.
 */
export function setupCaused(run: RunLists, setup: SetupSpan, messages: MessageMarks): SetupCaused {
  const deliveries = run.deliveries.flatMap((delivery, index) =>
    index >= setup.deliveries && delivery.messageId <= (messages[delivery.service ?? ""] ?? 0)
      ? [index]
      : [],
  )
  const windows = answering(run.deliveries, deliveries)
  const exchanges = run.exchanges.flatMap((exchange, index) =>
    index >= setup.exchanges && exchange.client !== "browser" && within(windows, exchange.startedAt)
      ? [index]
      : [],
  )

  return {
    exchanges,
    deliveries,
    data: causedStatements(run.dataCalls, setup.data, windows),
    sockets: [],
  }
}
