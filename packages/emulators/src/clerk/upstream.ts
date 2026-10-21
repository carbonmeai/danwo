import type { ProfileUpstream } from "../oauth/upstream-profile.ts"
import type { Store } from "../store.ts"

/** How an instance reaches a social provider's token and profile endpoints. */
type Upstream = ProfileUpstream

/** Where each emulator reaches its social providers, once the runner connects them. */
const UPSTREAMS = new WeakMap<Store, Upstream>()

/**
 * Connects a Clerk emulator to its social providers: a social sign-in's code exchange and profile
 * lookup go through `upstream`, typically the Google emulator.
 */
export function connectClerkUpstream(
  emulator: { readonly store: Store },
  upstream: Upstream,
): void {
  UPSTREAMS.set(emulator.store, upstream)
}

/** The upstream an emulator was connected to, if any. */
export function upstreamOf(store: Store): Upstream | undefined {
  return UPSTREAMS.get(store)
}
