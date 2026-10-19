/** What tests read from and do to a Composio emulator besides calling its API. */
import type { Emulator } from "../define.ts"
import { changeAccount } from "./accounts.ts"
import type { ConnectedAccountRecord, ExecutionRecord } from "./entities.ts"
import { ComposioEvents } from "./events.ts"
import { composioStore } from "./store.ts"

/** A connected account as tests see it. */
export interface ComposioAccountView {
  readonly id: string
  readonly userId: string
  readonly toolkit: string
  readonly status: ConnectedAccountRecord["status"]
  /** Who it is at the toolkit (an email, a login) once connected through a backend or the page. */
  readonly label: string | null
  readonly authConfigId: string
}

/** One tool run, as the project's logs keep it. */
export type ComposioExecution = ExecutionRecord

export interface ComposioProject {
  /** Every connected account, oldest first. */
  accounts(): ComposioAccountView[]
  /** Every tool run, oldest first; `source` says whether a seed, the backend or a sample answered. */
  executions(): ComposioExecution[]
  /**
   * Fires `trigger` on every enabled instance of it (only those on `connectedAccountId`, when
   * given): a `composio.trigger.message` webhook carrying `data` goes to the project's subscription.
   * Returns how many fired.
   */
  fire(
    trigger: string,
    data: Readonly<Record<string, unknown>>,
    connectedAccountId?: string,
  ): number
  /** Marks an account EXPIRED, as a revoked grant would, and sends the expiry webhook. */
  expire(connectedAccountId: string): void
}

export function composioProject(emulator: Pick<Emulator, "store" | "outbox">): ComposioProject {
  const objects = composioStore(emulator.store)
  const events = new ComposioEvents(emulator.outbox, emulator.store.clock)

  return {
    accounts: () =>
      objects.accounts.all().map((account) => ({
        id: account.id,
        userId: account.userId,
        toolkit: account.toolkit,
        status: account.status,
        label: account.label,
        authConfigId: account.authConfigId,
      })),
    executions: () => objects.executions.all(),
    fire(trigger, data, connectedAccountId) {
      const name = trigger.toUpperCase()
      const instances = objects.triggers.where(
        (t) =>
          t.triggerName === name &&
          t.disabledAt === null &&
          (connectedAccountId === undefined || t.accountId === connectedAccountId),
      )
      let fired = 0

      for (const instance of instances) {
        const account = objects.accounts.get(instance.accountId)

        if (account?.status !== "ACTIVE") continue
        events.trigger(instance, account, data)
        fired++
      }

      return fired
    },
    expire(connectedAccountId) {
      const account = changeAccount({ objects, clock: emulator.store.clock }, connectedAccountId, {
        status: "EXPIRED",
        statusReason: "The connection was revoked",
      })

      events.expired(account, objects.authConfigs.get(account.authConfigId))
    },
  }
}
