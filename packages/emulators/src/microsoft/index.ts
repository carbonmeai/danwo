import { randomUUID } from "node:crypto"

import type { Emulator } from "../define.ts"
import { defineEmulator } from "../define.ts"
import { providerErrors } from "../errors.ts"
import { type PersonName, personName } from "../oauth/account.ts"
import { createSigningKey } from "../oauth/jwt.ts"
import { type SignIns, signIns } from "../oauth/sign-ins.ts"
import type { Store } from "../store.ts"
import type { MicrosoftRouteContext } from "./context.ts"
import { aadError, CONSUMER_TENANT_ID } from "./helpers.ts"
import { authorizeRoutes } from "./routes/authorize.ts"
import { discoveryRoutes } from "./routes/discovery.ts"
import { meRoutes } from "./routes/me.ts"
import { tokenRoutes } from "./routes/token.ts"
import { microsoftStore } from "./store.ts"

export type * from "./entities.ts"
export { microsoftOutboundFaults } from "./faults.ts"
export { CONSUMER_TENANT_ID, MICROSOFT_HOSTS } from "./helpers.ts"

/** A seeded account: a personal one unless `tenant_id` names a work directory. */
export type MicrosoftSeedUser = { readonly email: string } & Partial<
  PersonName & { tenant_id: string }
>

export type MicrosoftSeedClient = {
  readonly client_id: string
  readonly client_secret: string
  readonly name: string
  readonly redirect_uris: readonly string[]
  readonly tenant_id?: string
}

/** Accounts and app registrations to load into a Microsoft emulator. */
export type MicrosoftSeedConfig = Partial<{
  readonly users: readonly MicrosoftSeedUser[]
  readonly oauth_clients: readonly MicrosoftSeedClient[]
}>

function addUser(store: Store, seed: MicrosoftSeedUser): void {
  microsoftStore(store).users.insert({
    oid: randomUUID(),
    email: seed.email,
    ...personName(seed.email, seed),
    tenant_id: seed.tenant_id ?? CONSUMER_TENANT_ID,
  })
}

/** Loads accounts and app registrations into a Microsoft emulator's store. */
export function seedMicrosoft(store: Store, config: MicrosoftSeedConfig): void {
  for (const user of config.users ?? []) addUser(store, user)

  for (const client of config.oauth_clients ?? [])
    microsoftStore(store).clients.insert({
      ...client,
      redirect_uris: [...client.redirect_uris],
      tenant_id: client.tenant_id ?? "common",
    })
}

/** Who signed in to which app, for tests. */
export function microsoftSignIns(emulator: Pick<Emulator, "store">): SignIns {
  return signIns(
    () => microsoftStore(emulator.store),
    (oid) => microsoftStore(emulator.store).users.findOneBy("oid", oid)?.email,
  )
}

function routes(context: MicrosoftRouteContext): void {
  for (const register of [discoveryRoutes, authorizeRoutes, tokenRoutes, meRoutes])
    register(context)
}

/**
 * Sign in with Microsoft (Entra ID v2.0): tenant paths, the account picker, the token endpoint
 * with PKCE and refresh, discovery and keys, and Graph's `/me`, on Microsoft's real hostnames.
 */
export const microsoft = defineEmulator({
  name: "microsoft",
  setup({ app, store, clock }) {
    app.onError(
      providerErrors((c, status, message) =>
        aadError(c, clock, { status, error: "server_error", code: 90033, message }),
      ),
    )
    routes({ app, clock, microsoft: () => microsoftStore(store), key: createSigningKey() })
  },
})
