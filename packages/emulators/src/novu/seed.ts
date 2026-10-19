import type { Store } from "../store.ts"
import type { NovuStepTemplate } from "./entities.ts"
import { novuStore, objectId } from "./store.ts"

/** A subscriber to start with. */
export type NovuSeedSubscriber = { readonly subscriberId: string } & Partial<{
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
  readonly data: Readonly<Record<string, unknown>>
}>

/** A workflow made in the dashboard: its steps' subjects and bodies may use `{{payload.x}}`. */
export interface NovuSeedWorkflow {
  readonly workflowId: string
  readonly name?: string
  readonly tags?: readonly string[]
  readonly steps: readonly NovuStepTemplate[]
}

/** Data to load into a Novu emulator. */
export type NovuSeedConfig = Partial<{
  /** The secret key (`NOVU_API_KEY`, `NOVU_SECRET_KEY`): server calls and bridge signatures. */
  readonly apiKey: string
  /** The Inbox's `applicationIdentifier` (`NOVU_APP_ID`, `VITE_NOVU_APP_IDENTIFIER`). */
  readonly applicationIdentifier: string
  /** The app's `@novu/framework` bridge, e.g. `http://127.0.0.1:4400/api/novu-bridge`. */
  readonly bridgeUrl: string
  /** Requires the Inbox to send `subscriberHash`, the HMAC-SHA256 of the subscriber id. */
  readonly hmac: boolean
  readonly subscribers: readonly NovuSeedSubscriber[]
  readonly workflows: readonly NovuSeedWorkflow[]
}>

/** The environment every Novu emulator answers for until a seed says otherwise. */
export const NOVU_DEFAULTS = {
  apiKey: "danwo-novu-secret-key",
  applicationIdentifier: "danwo-novu-app",
} as const

/** Loads `config` into a Novu emulator's store; the environment's settings replace the defaults. */
export function seedNovu(store: Store, config: NovuSeedConfig): void {
  const objects = novuStore(store)
  const current = objects.environment()
  const now = store.clock().toISOString()
  const env = {
    id: current?.id ?? objectId(),
    organization_id: current?.organization_id ?? objectId(),
    api_key: config.apiKey ?? current?.api_key ?? NOVU_DEFAULTS.apiKey,
    application_identifier:
      config.applicationIdentifier ??
      current?.application_identifier ??
      NOVU_DEFAULTS.applicationIdentifier,
    bridge_url: config.bridgeUrl ?? current?.bridge_url ?? null,
    hmac: config.hmac ?? current?.hmac ?? false,
  }

  if (current) objects.environments.change(current.id, env)
  else objects.environments.add(env, null)

  for (const subscriber of config.subscribers ?? [])
    objects.subscribers.add(
      {
        id: objectId(),
        subscriber_id: subscriber.subscriberId,
        first_name: subscriber.firstName ?? null,
        last_name: subscriber.lastName ?? null,
        email: subscriber.email ?? null,
        phone: subscriber.phone ?? null,
        avatar: null,
        locale: null,
        timezone: null,
        data: subscriber.data ? { ...subscriber.data } : null,
        channels: [],
        created: now,
        updated: now,
      },
      null,
    )

  for (const workflow of config.workflows ?? []) {
    objects.workflows.remove(workflow.workflowId)
    objects.workflows.add(
      {
        id: workflow.workflowId,
        name: workflow.name ?? workflow.workflowId,
        tags: [...(workflow.tags ?? [])],
        steps: [...workflow.steps],
      },
      null,
    )
  }
}
