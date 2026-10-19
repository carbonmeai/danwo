/**
 * The backend emulators a Composio emulator is connected to, by provider. Without one, a toolkit's
 * accounts connect on Composio's own page and its tools answer with seeded or sample data.
 */
import type { Emulator } from "../../define.ts"
import type { Store } from "../../store.ts"
import type { Backend, BackendName } from "./backend.ts"
import { githubBackend } from "./github.ts"
import { googleBackend } from "./google.ts"
import { microsoftBackend } from "./microsoft.ts"
import { slackBackend } from "./slack.ts"

export type { Backend, BackendAnswer, BackendName, OAuthClient } from "./backend.ts"

const BACKENDS: readonly Backend[] = [googleBackend, slackBackend, githubBackend, microsoftBackend]

/** The emulators each Composio emulator reaches, by provider; see `connectComposioBackends`. */
const CONNECTED = new WeakMap<Store, Partial<Record<BackendName, Emulator>>>()

/** Which emulator backs which provider, for `connectComposioBackends`. */
export type ComposioBackends = Partial<Record<BackendName, Emulator>>

/**
 * Connects a Composio emulator to the emulators behind its toolkits: Gmail, Calendar and Drive to
 * the Google emulator, Slack, GitHub and Outlook to theirs. A connected toolkit's accounts sign in
 * on that emulator's own consent page and its tools act on that emulator's state, so a
 * `GMAIL_SEND_EMAIL` lands in the Google emulator's mailbox. Calling it again adds to the set.
 */
export function connectComposioBackends(
  composio: Pick<Emulator, "store">,
  backends: ComposioBackends,
): void {
  CONNECTED.set(composio.store, { ...CONNECTED.get(composio.store), ...backends })
}

/** A connected backend for `toolkit`, with the emulator it runs on. */
export interface ConnectedBackend {
  readonly backend: Backend
  readonly emulator: Emulator
}

/** The backend serving `toolkit` for this Composio emulator, when one is connected. */
export function backendFor(store: Store, toolkit: string): ConnectedBackend | undefined {
  const backend = BACKENDS.find((candidate) => candidate.toolkits.includes(toolkit))
  const emulator = backend && CONNECTED.get(store)?.[backend.name]

  return backend && emulator ? { backend, emulator } : undefined
}
