import { clerk, CLERK_HOSTS, type ClerkSeedConfig, seedClerk } from "@danwo/emulators"

import { clerkMail } from "../mail/index.ts"
import {
  type OAuthEnvironment,
  oauthEnvironment,
  type OAuthService,
  oauthService,
  type Provider,
  type Seed,
} from "./oauth.ts"

/** Options of `clerkService()` and `clerkEnvironment()`. */
export interface ClerkOptions {
  /**
   * The instance (slug, secret key, origin, signing key, password or code sign-in), users,
   * organizations, JWT templates and webhook endpoints.
   */
  readonly seed?: Seed<ClerkSeedConfig>
}

/** What `clerkEnvironment()` starts: the Clerk emulator behind its own proxy. */
export type ClerkEnvironment = OAuthEnvironment<"clerk">

const CLERK: Provider<ClerkSeedConfig> = {
  name: "clerk",
  definition: clerk,
  hosts: CLERK_HOSTS,
  apply: (emulator, config) => seedClerk(emulator.store, config),
}

/**
 * Clerk for `startServices`: a development instance on its real hosts. The app's server reaches
 * the Backend API on `api.clerk.com`; the browser loads ClerkJS and `<SignIn/>` from the Frontend
 * API on `<slug>.clerk.accounts.dev`, or signs in on the Account Portal at `<slug>.accounts.dev`,
 * through the same proxy. Its webhooks go to the seeded endpoints, signed the Svix way. Gives
 * tests the `clerk` fixture (read keys, sessions and codes with `clerkInstance(clerk)`), and the
 * codes it emails reach the `mail` fixture and the agent.
 */
export function clerkService(options: ClerkOptions = {}): OAuthService {
  const service = oauthService(CLERK, options.seed)

  return { ...service, mail: [clerkMail(service.emulator)] }
}

/** A worker-scoped Clerk emulator behind its own proxy; combine services with `startServices`. */
export function clerkEnvironment(
  options: ClerkOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<ClerkEnvironment> {
  return oauthEnvironment("clerk", clerkService(options), options)
}
