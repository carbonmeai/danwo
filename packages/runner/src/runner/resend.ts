/**
 * Resend as a service: the app's calls to `api.resend.com` are answered by the Resend emulator,
 * which keeps every email it accepts in an inbox tests read with `resendInbox(resend)`.
 */
import { resend, type ResendSeedConfig, seedResend } from "@danwo/emulators"

import { resendMail } from "../mail/index.ts"
import {
  type OAuthEnvironment,
  oauthEnvironment,
  type OAuthService,
  oauthService,
  type Provider,
  type Seed,
} from "./oauth.ts"

/** The hosts the Resend emulator answers. */
export const RESEND_HOSTS: readonly string[] = ["api.resend.com"]

/** Options of `resendService()` and `resendEnvironment()`. */
export interface ResendOptions {
  /** Domains, API keys, webhook endpoints and a recipient allowlist. */
  readonly seed?: Seed<ResendSeedConfig>
}

/** What `resendEnvironment()` starts: the Resend emulator behind its own proxy. */
export type ResendEnvironment = OAuthEnvironment<"resend">

const RESEND: Provider<ResendSeedConfig> = {
  name: "resend",
  definition: resend,
  hosts: RESEND_HOSTS,
  apply: (emulator, config) => seedResend(emulator.store, config),
}

/**
 * Resend for `startServices`: sending email, domains, API keys and signed webhooks on
 * `api.resend.com`; gives tests the `resend` fixture and `resendMail(resend)` as a mail source.
 */
export function resendService(options: ResendOptions = {}): OAuthService {
  const service = oauthService(RESEND, options.seed)

  return { ...service, mail: [resendMail(service.emulator)] }
}

/** A worker-scoped Resend emulator behind its own proxy; combine services with `startServices`. */
export function resendEnvironment(
  options: ResendOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<ResendEnvironment> {
  return oauthEnvironment("resend", resendService(options), options)
}
