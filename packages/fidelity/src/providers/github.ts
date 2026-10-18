/**
 * GitHub's fidelity suite on public data: a public repository, its issues list, and the 404 for a
 * repository that does not exist. With the public opt-in set, a live run calls GitHub without a
 * key (an optional token raises the rate limit); the goldens are recorded from it.
 */
import { github, seedGithub } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.github.com"
const TOKEN = "DANWO_FIDELITY_GITHUB_TOKEN"
const REPO = "octocat/Hello-World"

function call(context: ScenarioContext, path: string): Request {
  const token = context.target.credentials["token"]

  return new Request(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "danwo-fidelity",
      ...(token !== undefined && { authorization: `Bearer ${token}` }),
    },
  })
}

const repository: Scenario = {
  name: "repos: public repository",
  async run(context) {
    await context.step("read a public repository", call(context, `/repos/${REPO}`), {
      literals: ["private", "visibility", "owner.type"],
      maps: ["permissions", "license"],
    })
  },
}

const missing: Scenario = {
  name: "errors: unknown repository",
  async run(context) {
    await context.step(
      "read a repository that does not exist",
      call(context, `/repos/${REPO}-danwo-missing-${context.unique}`),
      { literals: ["message", "status"] },
    )
  },
}

export const githubFidelity: FidelityProvider = {
  name: "github",
  credentials: [
    PUBLIC_ENDPOINTS,
    {
      name: TOKEN,
      description: "a token with no scopes, to raise the rate limit",
      optional: true,
    },
  ],
  scenarios: [repository, missing],
  emulator: () =>
    emulatorTarget(github, {}, (emulator) =>
      seedGithub(emulator.store, {
        users: [{ login: "octocat" }],
        repos: [{ repo: REPO, description: "My first repository on GitHub!" }],
      }),
    ),
  live(env) {
    if (!publicEndpointsAllowed(env)) return undefined

    const token = env[TOKEN]?.trim()

    return liveTarget(token === undefined || token === "" ? {} : { token })
  },
}
