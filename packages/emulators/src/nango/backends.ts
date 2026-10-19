/**
 * The emulators behind Nango's integrations: a connection's proxied calls go to the provider's
 * real API with the connection's access token, so with a backend connected they land on that
 * emulator. Its credentials have to be ones the backend issued; seed the connection with them.
 */
import type { Emulator } from "../define.ts"
import type { Store } from "../store.ts"

export type NangoBackendName = "google" | "microsoft" | "slack" | "github"

/** Which emulator backs which provider family, for `connectNangoBackends`. */
export type NangoBackends = Partial<Record<NangoBackendName, Emulator>>

const CONNECTED = new WeakMap<Store, NangoBackends>()

/** The API base each Nango provider's proxied paths are relative to, and the backend that serves it. */
const PROVIDERS: Readonly<
  Record<string, { readonly backend: NangoBackendName; readonly base: string }>
> = {
  "google-mail": { backend: "google", base: "https://gmail.googleapis.com" },
  gmail: { backend: "google", base: "https://gmail.googleapis.com" },
  "google-calendar": { backend: "google", base: "https://www.googleapis.com" },
  "google-drive": { backend: "google", base: "https://www.googleapis.com" },
  google: { backend: "google", base: "https://www.googleapis.com" },
  microsoft: { backend: "microsoft", base: "https://graph.microsoft.com" },
  outlook: { backend: "microsoft", base: "https://graph.microsoft.com" },
  "one-drive": { backend: "microsoft", base: "https://graph.microsoft.com" },
  "microsoft-teams": { backend: "microsoft", base: "https://graph.microsoft.com" },
  slack: { backend: "slack", base: "https://slack.com/api" },
  github: { backend: "github", base: "https://api.github.com" },
  "github-app": { backend: "github", base: "https://api.github.com" },
}

/**
 * Connects a Nango emulator to the emulators behind its integrations: Gmail, Calendar and Drive
 * integrations to the Google emulator, Outlook and OneDrive to Microsoft's, Slack and GitHub to
 * theirs. Calling it again adds to the set.
 */
export function connectNangoBackends(
  nango: Pick<Emulator, "store">,
  backends: NangoBackends,
): void {
  CONNECTED.set(nango.store, { ...CONNECTED.get(nango.store), ...backends })
}

/** Where a proxied call for `provider` goes, when its backend is connected. */
export function backendFor(
  store: Store,
  provider: string,
): { readonly emulator: Emulator; readonly base: string } | undefined {
  const route = PROVIDERS[provider]
  const emulator = route && CONNECTED.get(store)?.[route.backend]

  return route && emulator ? { emulator, base: route.base } : undefined
}
