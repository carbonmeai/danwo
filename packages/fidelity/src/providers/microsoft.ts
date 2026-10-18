/**
 * Microsoft's fidelity suite, limited to what needs no tenant: the identity platform's discovery
 * document and signing keys for the `common` authority. With the public opt-in set, a live run
 * calls Microsoft's own endpoints; the goldens are recorded from them.
 */
import { microsoft } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario } from "../scenario.ts"
import { emulatorTarget, liveTarget } from "../target.ts"

const LOGIN = "https://login.microsoftonline.com/common"

const discovery: Scenario = {
  name: "sign-in: discovery document",
  async run(context) {
    await context.step(
      "read the discovery document",
      new Request(`${LOGIN}/v2.0/.well-known/openid-configuration`),
      { literals: ["issuer", "jwks_uri", "token_endpoint", "authorization_endpoint"] },
    )
  },
}

const keys: Scenario = {
  name: "sign-in: signing keys",
  async run(context) {
    await context.step("read the signing keys", new Request(`${LOGIN}/discovery/v2.0/keys`), {
      literals: ["keys[].kty", "keys[].use"],
    })
  },
}

export const microsoftFidelity: FidelityProvider = {
  name: "microsoft",
  credentials: [PUBLIC_ENDPOINTS],
  scenarios: [discovery, keys],
  emulator: () => emulatorTarget(microsoft, {}),
  live: (env) => (publicEndpointsAllowed(env) ? liveTarget({}) : undefined),
}
