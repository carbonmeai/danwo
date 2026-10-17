import type { Emulator } from "../define.ts"
import { defineEmulator } from "../define.ts"
import { providerErrors } from "../errors.ts"
import { type PersonName, personName } from "../oauth/account.ts"
import { createSigningKey } from "../oauth/jwt.ts"
import { type SignIns, signIns } from "../oauth/sign-ins.ts"
import type { Store } from "../store.ts"
import type { GoogleRouteContext } from "./context.ts"
import { googleError, newUid } from "./helpers.ts"
import { authorizeRoutes } from "./routes/authorize.ts"
import { discoveryRoutes } from "./routes/discovery.ts"
import { revokeRoutes } from "./routes/revoke.ts"
import { tokenRoutes } from "./routes/token.ts"
import { userinfoRoutes } from "./routes/userinfo.ts"
import { googleStore } from "./store.ts"

export type * from "./entities.ts"
export { googleOutboundFaults } from "./faults.ts"
export { GOOGLE_ENDPOINTS, GOOGLE_HOSTS, GOOGLE_ISSUER } from "./helpers.ts"
export type { SignIn, SignIns } from "../oauth/sign-ins.ts"

/** A seeded Google account; names are split from `name` unless given. */
export type GoogleSeedUser = { readonly email: string } & Partial<
  PersonName & { picture: string; locale: string; email_verified: boolean; hd: string }
>

export type GoogleSeedClient = {
  readonly client_id: string
  readonly client_secret: string
  readonly name: string
  readonly redirect_uris: readonly string[]
}

/** Accounts and OAuth clients to load into a Google emulator. */
export type GoogleSeedConfig = Partial<{
  readonly users: readonly GoogleSeedUser[]
  readonly oauth_clients: readonly GoogleSeedClient[]
}>

function addUser(store: Store, seed: GoogleSeedUser): void {
  googleStore(store).users.insert({
    uid: newUid(),
    email: seed.email,
    ...personName(seed.email, seed),
    picture: seed.picture ?? null,
    email_verified: seed.email_verified ?? true,
    locale: seed.locale ?? "en",
    hd: seed.hd ?? null,
  })
}

/** Loads accounts and OAuth clients into a Google emulator's store. */
export function seedGoogle(store: Store, config: GoogleSeedConfig): void {
  for (const user of config.users ?? []) addUser(store, user)

  for (const client of config.oauth_clients ?? [])
    googleStore(store).clients.insert({ ...client, redirect_uris: [...client.redirect_uris] })
}

/** Who signed in to which client, for tests. */
export function googleSignIns(emulator: Pick<Emulator, "store">): SignIns {
  return signIns(
    () => googleStore(emulator.store),
    (uid) => googleStore(emulator.store).users.findOneBy("uid", uid)?.email,
  )
}

function routes(context: GoogleRouteContext): void {
  for (const register of [
    discoveryRoutes,
    authorizeRoutes,
    tokenRoutes,
    userinfoRoutes,
    revokeRoutes,
  ])
    register(context)
}

/**
 * Sign in with Google: the account chooser, OpenID Connect discovery, the token endpoint with
 * PKCE and refresh, userinfo, signing keys and revocation, on Google's real hostnames.
 */
export const google = defineEmulator({
  name: "google",
  setup({ app, store, clock }) {
    app.onError(
      providerErrors((c, status, message) => googleError(c, status, "internal_failure", message)),
    )
    routes({ app, clock, google: () => googleStore(store), key: createSigningKey() })
  },
})
