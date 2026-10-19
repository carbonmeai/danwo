/**
 * Composio's fidelity suite: the key errors, which need no key (with the public opt-in), and with a
 * project key the catalogue (a toolkit, a tool's schema, trigger types) and the project's auth
 * configs and connected accounts lists. Reads only, so a live run changes nothing in the project.
 */
import { composio, seedComposio } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS } from "../provider.ts"
import type { Scenario, ScenarioContext, StepDoc } from "../scenario.ts"
import { emulatorTarget, keyOrPublicTarget } from "../target.ts"

const API = "https://backend.composio.dev/api/v3.1"
const KEY = "DANWO_FIDELITY_COMPOSIO_KEY"

/** Composio's error envelope, as the SDK reads it. */
const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["message", "code", "slug", "status", "request_id"],
      properties: {
        message: { type: "string" },
        code: { type: "number" },
        slug: { type: "string" },
        status: { type: "number" },
        request_id: { type: "string" },
        suggested_fix: { type: "string" },
      },
    },
  },
}

const ERROR_LITERALS = ["error.code", "error.slug", "error.status"]

function errorDoc(status: number, code: number, slug: string): StepDoc {
  return { schema: ERROR_SCHEMA, status, literals: { "error.code": code, "error.slug": slug } }
}

function call(context: ScenarioContext, path: string): Request {
  const key = context.target.credentials["key"]

  if (key === undefined) context.skip(`set ${KEY} to a project key to check the API's reads`)

  return new Request(`${API}${path}`, { headers: { "x-api-key": key } })
}

const errors: Scenario = {
  name: "errors: no key, unknown key",
  async run(context) {
    await context.step("call without a key", new Request(`${API}/toolkits/gmail`), {
      literals: ERROR_LITERALS,
      doc: errorDoc(401, 906, "Auth_NoAuthProvided"),
    })
    await context.step(
      "call with a key Composio never issued",
      new Request(`${API}/toolkits/gmail`, { headers: { "x-api-key": "REDACTED-TEST-VALUE" } }),
      { literals: ERROR_LITERALS, doc: errorDoc(401, 801, "APIKey_InvalidAPIKey") },
    )
  },
}

const catalogue: Scenario = {
  name: "catalogue: a toolkit, a tool, a trigger type",
  async run(context) {
    await context.step("read the Gmail toolkit", call(context, "/toolkits/gmail"), {
      literals: ["slug", "type"],
      doc: { operation: "get /api/v3.1/toolkits/{slug}", status: 200 },
    })
    await context.step("read GMAIL_SEND_EMAIL", call(context, "/tools/GMAIL_SEND_EMAIL"), {
      literals: ["slug", "toolkit.slug"],
      maps: ["input_parameters", "output_parameters"],
      doc: { operation: "get /api/v3.1/tools/{tool_slug}", status: 200 },
    })
    await context.step(
      "read GITHUB_COMMIT_EVENT",
      call(context, "/triggers_types/GITHUB_COMMIT_EVENT"),
      {
        literals: ["slug", "type", "toolkit.slug"],
        maps: ["config", "payload"],
        doc: { operation: "get /api/v3.1/triggers_types/{slug}", status: 200 },
      },
    )
  },
}

/*
 * A whole page shapes every item together, so accounts in different states (active with tokens,
 * expired, mid-link) merge into one shape; a one-item page checks the cursor to the next.
 */
const project: Scenario = {
  name: "project: auth configs and connected accounts",
  async run(context) {
    await context.step("list auth configs", call(context, "/auth_configs?limit=50"), {
      maps: ["items[].credentials"],
      doc: { operation: "get /api/v3.1/auth_configs", status: 200 },
    })
    await context.step("page auth configs", call(context, "/auth_configs?limit=1"), {
      maps: ["items[]"],
      doc: { operation: "get /api/v3.1/auth_configs", status: 200 },
    })
    await context.step("list connected accounts", call(context, "/connected_accounts?limit=50"), {
      maps: ["items[].data", "items[].state.val"],
      doc: { operation: "get /api/v3.1/connected_accounts", status: 200 },
    })
    await context.step("page connected accounts", call(context, "/connected_accounts?limit=1"), {
      maps: ["items[]"],
      doc: { operation: "get /api/v3.1/connected_accounts", status: 200 },
    })
  },
}

export const composioFidelity: FidelityProvider = {
  name: "composio",
  leaves: "nothing: the suite only reads",
  openapi: "https://backend.composio.dev/api/v3.1/openapi.json",
  credentials: [
    PUBLIC_ENDPOINTS,
    { name: KEY, description: "a Composio project API key (ak_…); runs only read", optional: true },
  ],
  scenarios: [errors, catalogue, project],
  /*
   * Only the stand-in key is the project's, so an unknown key is refused as the live API refuses it.
   * Two auth configs and two accounts give a one-item page a next page, as a project in use has.
   */
  emulator: () =>
    emulatorTarget(composio, { key: "ak_danwo_fidelity" }, (emulator) =>
      seedComposio(emulator.store, {
        apiKeys: ["ak_danwo_fidelity"],
        authConfigs: [{ toolkit: "gmail" }, { toolkit: "github" }],
        connectedAccounts: [
          { userId: "fidelity-user-1", toolkit: "gmail" },
          { userId: "fidelity-user-2", toolkit: "github", status: "EXPIRED" },
        ],
      }),
    ),
  /* Composio has no test mode: a project key is the sandbox, so a dedicated test project's key belongs here. */
  live: (env) => keyOrPublicTarget(env, KEY),
}
