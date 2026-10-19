/**
 * Google's fidelity suite, limited to what needs no account: the OpenID Connect discovery document
 * and the signing keys an app verifies ID tokens with. With the public opt-in set, a live run calls
 * Google's own endpoints; the goldens are recorded from them.
 */
import { google } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario } from "../scenario.ts"
import { emulatorTarget, liveTarget } from "../target.ts"

const discovery: Scenario = {
  name: "sign-in: discovery document",
  async run(context) {
    await context.step(
      "read the discovery document",
      new Request("https://accounts.google.com/.well-known/openid-configuration"),
      { literals: ["issuer", "jwks_uri", "token_endpoint", "authorization_endpoint"] },
    )
  },
}

const keys: Scenario = {
  name: "sign-in: signing keys",
  async run(context) {
    await context.step(
      "read the signing keys",
      new Request("https://www.googleapis.com/oauth2/v3/certs"),
      { literals: ["keys[].kty", "keys[].alg", "keys[].use"] },
    )
  },
}

export const googleFidelity: FidelityProvider = {
  name: "google",
  leaves: "nothing: the suite only reads public discovery documents",
  credentials: [PUBLIC_ENDPOINTS],
  scenarios: [discovery, keys],
  emulator: () => emulatorTarget(google, {}),
  live: (env) => (publicEndpointsAllowed(env) ? liveTarget({}) : undefined),
}
