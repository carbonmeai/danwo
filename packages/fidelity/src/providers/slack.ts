/**
 * Slack's fidelity suite on calls that need no workspace: `api.test`, and the errors for a missing
 * and an unknown token. With the public opt-in set, a live run calls Slack's Web API with no
 * token, so it can never post anywhere; the goldens are recorded from it.
 */
import { slack } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario } from "../scenario.ts"
import { emulatorTarget, liveTarget } from "../target.ts"

const API = "https://slack.com/api"

function method(name: string, token?: string): Request {
  return new Request(`${API}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(token !== undefined && { authorization: `Bearer ${token}` }),
    },
    body: new URLSearchParams({ channel: "C0000000000", text: "danwo fidelity" }),
  })
}

const LITERALS = ["ok", "error"]

const apiTest: Scenario = {
  name: "api.test",
  async run(context) {
    await context.step("call api.test", method("api.test"), { literals: LITERALS, maps: ["args"] })
  },
}

const errors: Scenario = {
  name: "errors: missing token, unknown token",
  async run(context) {
    await context.step("auth.test without a token", method("auth.test"), { literals: LITERALS })
    await context.step(
      "chat.postMessage with an unknown token",
      method("chat.postMessage", "REDACTED-TEST-VALUE"),
      { literals: LITERALS },
    )
  },
}

export const slackFidelity: FidelityProvider = {
  name: "slack",
  credentials: [PUBLIC_ENDPOINTS],
  scenarios: [apiTest, errors],
  emulator: () => emulatorTarget(slack, {}),
  live: (env) => (publicEndpointsAllowed(env) ? liveTarget({}) : undefined),
}
