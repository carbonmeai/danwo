/**
 * What happens after the API answered: webhooks for payments, transfers and subscriptions, a
 * transfer's status settling on the emulator's clock as Flutterwave's test-mode references say, and
 * subscriptions charging their card when their interval has passed.
 */
import type { DataKey, Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import type { FlutterwaveRouteContext, FlutterwaveState } from "./context.ts"
import type { Subscription, Transaction, Transfer } from "./entities.ts"
import { chargeCompleted, transferCompleted } from "./formatters.ts"
import { isoTime } from "./helpers.ts"

/** The dashboard's webhook: where events go, and the secret hash they carry. */
export interface WebhookSettings {
  readonly url: string
  readonly secretHash: string
}

const WEBHOOK: DataKey<WebhookSettings> = { name: "flutterwave.webhook" }

/** Sets the dashboard's webhook URL and secret hash. */
export function setWebhook(store: Store, settings: WebhookSettings): void {
  store.setData(WEBHOOK, settings)
}

/** The topic a transfer's change goes under when it names its own callback URL. */
function callbackTopic(url: string): string {
  return `transfer.completed ${new URL(url).pathname}`
}

/** Where webhooks go: the dashboard's URL, and the callback URLs transfers named. */
export function webhookEndpoints(
  context: Pick<FlutterwaveRouteContext, "store" | "flutterwave">,
): WebhookEndpoint[] {
  const settings = context.store.getData(WEBHOOK)

  if (settings === undefined) return []

  const dashboard: WebhookEndpoint = {
    id: "dashboard",
    url: settings.url,
    events: ["charge.completed", "transfer.completed", "subscription.cancelled"],
    secret: settings.secretHash,
    enabled: true,
  }
  const callbacks = new Set(
    context.flutterwave.transfers
      .all()
      .map((transfer) => context.flutterwave.transfers.extra(String(transfer.id))?.callbackUrl)
      .filter((url): url is string => typeof url === "string"),
  )

  return [
    dashboard,
    ...[...callbacks].map((url) => ({
      id: `callback ${url}`,
      url,
      events: [callbackTopic(url)],
      secret: settings.secretHash,
      enabled: true,
    })),
  ]
}

/** How a transfer can end. */
type SettledStatus = "SUCCESSFUL" | "FAILED"

/** A test-mode transfer reference's outcome: `_PMCK` succeeds, `_PMCK_ST_F` fails, `DU_n` sets the minutes. */
function mockedOutcome(
  reference: string,
): { readonly status: SettledStatus; readonly afterMs: number } | undefined {
  const match = /_PMCK(_ST_F)?(?:DU_(\d+))?$/.exec(reference)

  if (!match) return undefined

  const minutes = match[2] === undefined ? 10 : Number(match[2])

  return { status: match[1] ? "FAILED" : "SUCCESSFUL", afterMs: minutes * 60_000 }
}

export class FlutterwaveEvents {
  private readonly context: FlutterwaveState

  constructor(context: FlutterwaveState) {
    this.context = context
  }

  /** Sends `charge.completed` for a payment attempt that ended, successfully or not. */
  charged(transaction: Transaction): void {
    this.context.outbox.push("charge.completed", chargeCompleted(transaction))
  }

  /** Sends `subscription.cancelled`. */
  subscriptionCancelled(subscription: Subscription): void {
    this.context.outbox.push("subscription.cancelled", {
      event: "subscription.cancelled",
      data: { ...subscription, status: "cancelled" },
    })
  }

  /**
   * A new transfer starts as NEW, then PENDING; with a mocked reference it settles after its
   * minutes. A failed transfer gives its money back to the balance.
   */
  scheduleTransfer(transfer: Transfer): void {
    const outcome = mockedOutcome(transfer.reference)

    this.context.flutterwave.transfers.change(String(transfer.id), { status: "PENDING" })

    if (outcome === undefined) return

    this.context.timer?.setTimeout(
      () => this.settleTransfer(transfer.id, outcome.status),
      outcome.afterMs,
    )
  }

  private settleTransfer(id: number, status: SettledStatus): void {
    const { transfers } = this.context.flutterwave
    const current = transfers.get(String(id))

    if (current === undefined || current.status !== "PENDING") return

    const settled = transfers.change(String(id), {
      status,
      complete_message: status === "SUCCESSFUL" ? "Successful" : "DISBURSE FAILED: Transfer failed",
    })

    if (settled === undefined) return
    if (status === "FAILED") this.creditBalance(settled.currency, settled.amount + settled.fee)

    const callback = transfers.extra(String(id))?.callbackUrl ?? null

    this.context.outbox.push(
      callback === null ? "transfer.completed" : callbackTopic(callback),
      transferCompleted(settled),
    )
  }

  /** Adds `amount` back to the balance in `currency`. */
  creditBalance(currency: string, amount: number): void {
    const { balances } = this.context.flutterwave
    const balance = balances.get(currency)

    if (balance === undefined) return

    balances.change(currency, {
      available_balance: balance.available_balance + amount,
      ledger_balance: balance.ledger_balance + amount,
    })
  }

  /** A timeline entry on a transaction. */
  note(transaction: Transaction, type: string, message: string): void {
    const { transactions } = this.context.flutterwave
    const extra = transactions.extra(String(transaction.id))

    if (extra === undefined) return

    transactions.setExtra(String(transaction.id), {
      ...extra,
      events: [...extra.events, { type, message, time: isoTime(this.context.clock()) }],
    })
  }
}
