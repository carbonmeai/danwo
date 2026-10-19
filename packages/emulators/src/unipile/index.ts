import { defineEmulator, type Emulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { addAccount, attendeeFor, fileEmail, postMessage, setStatus, startChat } from "./actions.ts"
import { UnipileError, unipileError, type UnipileRouteContext } from "./helpers.ts"
import { hostedRoutes } from "./hosted.ts"
import { apiRoutes } from "./routes.ts"
import {
  type UnipileAccountRecord,
  type UnipileAccountType,
  type UnipileEmailRecord,
  type UnipileMessageRecord,
  unipileStore,
} from "./store.ts"

export { unipileOutboundFaults } from "./faults.ts"
export { UNIPILE_HOSTS } from "./helpers.ts"
export type {
  UnipileAccountRecord,
  UnipileAccountType,
  UnipileEmailRecord,
  UnipileMessageRecord,
} from "./store.ts"

/** Data to load into a Unipile emulator. No webhooks are sent for seeded data. */
export type UnipileSeedConfig = Partial<{
  /** The access tokens accepted; when none are given, any non-empty one is. */
  tokens: readonly string[]
  accounts: readonly {
    readonly type: UnipileAccountType
    readonly name: string
    readonly username: string
    /** Kept across resets, so an app's database can name it. */
    readonly id?: string
  }[]
  /** Webhook subscriptions, with the headers Unipile adds to every delivery (an app's shared secret). */
  webhooks: readonly {
    readonly source: "messaging" | "email" | "account_status"
    readonly url: string
    readonly headers?: readonly { readonly key: string; readonly value: string }[]
  }[]
}>

const silent = { push: () => ({ id: 0, topic: "", body: null, createdAt: "" }) }

function contextFor(store: Store, outbox: Emulator["outbox"] | typeof silent): UnipileRouteContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- seeding and test helpers register no routes, so the app is never reached
  return {
    objects: unipileStore(store),
    store,
    clock: store.clock,
    outbox,
    app: undefined,
  } as unknown as UnipileRouteContext
}

/** Loads `config` into a Unipile emulator's store. */
export function seedUnipile(store: Store, config: UnipileSeedConfig): void {
  const context = contextFor(store, silent)

  if (config.tokens?.length) context.objects.addTokens(config.tokens)
  for (const account of config.accounts ?? []) addAccount(context, account)
  for (const [index, webhook] of (config.webhooks ?? []).entries())
    context.objects.webhooks.add(
      {
        id: `seeded-${index + 1}`,
        source: webhook.source,
        request_url: webhook.url,
        name: webhook.source,
        headers: [...(webhook.headers ?? [])],
        account_ids: [],
        events: [],
        enabled: true,
      },
      null,
    )
}

/** Reading a Unipile emulator from a test, and acting as the people on the other side. */
export interface UnipileWorkspace {
  accounts(): UnipileAccountRecord[]
  /** The messages of `accountId`'s chats, oldest first. */
  messages(accountId: string): UnipileMessageRecord[]
  emails(accountId: string): UnipileEmailRecord[]
  /** Someone messages the account (starting a chat with them when there is none): `message_received` goes out. */
  receive(
    accountId: string,
    from: { providerId: string; name?: string },
    text: string,
  ): UnipileMessageRecord
  /** Mail arrives in a mail account: `mail_received` goes out. */
  receiveEmail(
    accountId: string,
    mail: { from: string; subject: string; body?: string },
  ): UnipileEmailRecord
  /** The account's session stops working (`CREDENTIALS`), as when the user signed out on LinkedIn. */
  disconnect(accountId: string): void
}

/** The Unipile workspace an emulator stands in for. */
export function unipileWorkspace(emulator: Emulator): UnipileWorkspace {
  const context = contextFor(emulator.store, emulator.outbox)
  const { objects } = context

  const accountNamed = (id: string) => {
    const account = objects.accounts.get(id)

    if (!account) throw new Error(`no Unipile account ${id}`)

    return account
  }

  return {
    accounts: () => objects.accounts.all(),
    messages: (id) => objects.messages.where((m) => m.account_id === id),
    emails: (id) => objects.emails.where((e) => e.account_id === id),
    receive(id, from, text) {
      const account = accountNamed(id)
      const sender = attendeeFor(context, account, from.providerId, from.name)
      const chat =
        objects.chats.where((c) => c.account_id === id && c.attendee_ids.includes(sender.id))[0] ??
        startChat(context, account, [sender])

      return postMessage(context, chat, text, sender)
    },
    receiveEmail(id, mail) {
      const account = accountNamed(id)

      return fileEmail(context, account, {
        subject: mail.subject,
        body: mail.body ?? "",
        from: { display_name: mail.from, identifier: mail.from },
        to: [{ display_name: account.name, identifier: account.owner.username }],
        role: "inbox",
      })
    },
    disconnect: (id) => setStatus(context, accountNamed(id), "CREDENTIALS"),
  }
}

/** Where deliveries go: every enabled webhook by its source, and every hosted link's notify URL. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  const objects = unipileStore(store)
  const hooks = objects.webhooks.all().map((webhook) => ({
    id: webhook.id,
    url: webhook.request_url,
    events: [webhook.source],
    secret: "",
    enabled: webhook.enabled,
  }))
  const notify = objects.notifyUrls().map((url) => ({
    id: `notify:${url}`,
    url,
    events: [`notify:${url}`],
    secret: "",
    enabled: true,
  }))

  return [...hooks, ...notify]
}

/** Unipile adds no signature; each webhook carries the headers it was created with. */
function headersOf(store: Store, endpointId: string): Record<string, string> {
  const webhook = unipileStore(store).webhooks.get(endpointId)

  return {
    "Content-Type": "application/json",
    ...Object.fromEntries((webhook?.headers ?? []).map((h) => [h.key, h.value])),
  }
}

/**
 * Unipile (each account's DSN on `*.unipile.com`, and the hosted auth pages on
 * `account.unipile.com`): connected LinkedIn, WhatsApp and mail accounts, hosted auth links that
 * notify the app, profiles, chats and messages, mail, and webhooks for messages, mail and account
 * status, each sent with the headers its subscription named.
 */
export const unipile = defineEmulator({
  name: "unipile",
  setup({ app, store, outbox, clock }) {
    app.onError((error, c) => {
      if (error instanceof UnipileError)
        return unipileError(c, error.status, error.type, error.title, error.message)

      const status = error instanceof HttpError ? error.status : 500

      return unipileError(
        c,
        status,
        "errors/unexpected_error",
        "Unexpected error",
        error instanceof Error ? error.message : "",
      )
    })

    const context = { app, store, outbox, clock, objects: unipileStore(store) }

    apiRoutes(context)
    hostedRoutes(context)
  },
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    sign: ({ endpoint }) => headersOf(store, endpoint.id),
    policy: { retryDelaysMs: [30_000, 5 * 60_000, 30 * 60_000], timeoutMs: 15_000 },
  }),
})
