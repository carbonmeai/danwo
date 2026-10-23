/**
 * GitHub's fidelity suite. On public data, with the public opt-in set, it reads a public repository
 * and the 404 for one that does not exist, without a key (an optional token raises the rate limit).
 * With a GitHub App installed on one sandbox repository, it also goes through what danwo's GitHub
 * reporter and an App-backed integration do there: App authentication, issues and comments,
 * labels, branches and files, a pull request and its comment, check runs with annotations, and the
 * errors around them. Without the App's variables those scenarios are skipped.
 */
import { generateKeyPairSync } from "node:crypto"

import { github, seedGithub } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { emulatorTarget, liveTarget } from "../target.ts"
import { type AppCredentials, API, APP_VARIABLES, appCredentials } from "./github-app.ts"
import { GITHUB_APP_SCENARIOS } from "./github-scenarios.ts"
import { githubSweep } from "./github-sweep.ts"

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

/** The App the emulator plays: installed on the sandbox repository only, with the suite's permissions. */
const EMULATED_APP = { id: 424_242, slug: "danwo-fidelity", installationId: 777_001 }
const SANDBOX = { owner: "carbonmeai", repo: "carbonmeai/danwo-fidelity" }
const PERMISSIONS = {
  checks: "write",
  contents: "write",
  issues: "write",
  pull_requests: "write",
  metadata: "read",
}

/** One RSA key for every emulated run's App, made on first use: generating one takes a moment. */
let emulatedKey: string | undefined

function emulatorKey(): string {
  emulatedKey ??= generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs1", format: "pem" })
    .toString()

  return emulatedKey
}

/** The emulator: octocat's public repository, and the App installed on the sandbox repository. */
function emulator() {
  const app: AppCredentials = {
    appId: String(EMULATED_APP.id),
    privateKey: emulatorKey(),
    installationId: String(EMULATED_APP.installationId),
    repo: SANDBOX.repo,
  }

  return emulatorTarget(github, { ...app }, (emulated) =>
    seedGithub(emulated.store, {
      users: [{ login: "octocat" }],
      orgs: [{ login: SANDBOX.owner }],
      repos: [
        { repo: REPO, description: "My first repository on GitHub!", homepage: "" },
        {
          repo: SANDBOX.repo,
          description: "The sandbox danwo's GitHub fidelity suite runs in",
          private: true,
          files: { "README.md": "# danwo-fidelity\n" },
        },
      ],
      apps: [
        {
          id: EMULATED_APP.id,
          slug: EMULATED_APP.slug,
          name: "danwo fidelity",
          description: "Runs danwo's GitHub fidelity suite in its sandbox repository",
          owner: SANDBOX.owner,
          clientId: "Iv23liDanwoFidelity00",
          clientSecret: "danwo-fidelity-emulated-secret",
          privateKey: app.privateKey,
          permissions: PERMISSIONS,
        },
      ],
      installations: [
        {
          id: EMULATED_APP.installationId,
          app: EMULATED_APP.slug,
          account: SANDBOX.owner,
          repositories: ["danwo-fidelity"],
        },
      ],
    }),
  )
}

export const githubFidelity: FidelityProvider = {
  name: "github",
  leaves:
    "closed issues and pull requests titled danwo-fidelity-<run> (an App cannot delete them), and check runs on the commits of deleted branches",
  credentials: [
    PUBLIC_ENDPOINTS,
    {
      name: TOKEN,
      description: "a token with no scopes, to raise the rate limit for the public scenarios",
      optional: true,
    },
    {
      name: APP_VARIABLES.appId,
      description: "the id of a GitHub App installed on one sandbox repository only",
      optional: true,
    },
    {
      name: APP_VARIABLES.privateKey,
      description: "the App's private key (PEM, line breaks as \\n), or use the path variable",
      optional: true,
    },
    {
      name: APP_VARIABLES.privateKeyPath,
      description: "the path to the App's private key file (.pem)",
      optional: true,
    },
    {
      name: APP_VARIABLES.installationId,
      description: "the App's installation on the sandbox repository",
      optional: true,
    },
    {
      name: APP_VARIABLES.repo,
      description:
        "the sandbox repository (owner/name); the App's tokens are limited to it, and runs open and close tagged issues and pull requests there",
      optional: true,
    },
  ],
  scenarios: [repository, missing, ...GITHUB_APP_SCENARIOS],
  sweep: githubSweep,
  emulator,
  live(env) {
    const token = env[TOKEN]?.trim()
    const publicToken = token === undefined || token === "" ? {} : { token }
    const app = appCredentials(env)

    if (app !== undefined) return liveTarget({ ...app, ...publicToken })

    return publicEndpointsAllowed(env) ? liveTarget(publicToken) : undefined
  },
}
