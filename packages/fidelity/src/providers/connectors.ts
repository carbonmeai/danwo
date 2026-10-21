/**
 * Fidelity suites for Nylas, Nango and Unipile. Each checks its key errors, which need no key (with
 * the public opt-in) except Unipile's, which lives on an account's own DSN, and with a key the
 * application's or project's reads. Reads only, so a live run changes nothing.
 */
import { nango, nylas, seedNango, seedNylas, seedUnipile, unipile } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { emulatorTarget, liveTarget } from "../target.ts"

const object = (required: readonly string[], properties: Readonly<Record<string, unknown>>) => ({
  type: "object",
  required,
  properties,
})
const text = { type: "string" }
const list = (items: unknown) => ({ type: "array", items })

/* --- Nylas --- */

const NYLAS = "https://api.us.nylas.com"
const NYLAS_KEY = "DANWO_FIDELITY_NYLAS_KEY"
const NYLAS_FAILURE = object(["type", "message"], { type: text, message: text })
const NYLAS_ERROR = object(["request_id", "error"], { request_id: text, error: NYLAS_FAILURE })
/** With no credential at all, Nylas answers before it assigns a request id. */
const NYLAS_UNIDENTIFIED = object(["success", "error"], {
  success: { type: "boolean" },
  error: NYLAS_FAILURE,
})
const GRANT = object(["id", "provider", "grant_status", "email", "scope", "created_at"], {
  id: text,
  provider: text,
  grant_status: text,
  email: text,
  scope: list(text),
  created_at: { type: "number" },
  updated_at: { type: "number" },
  name: { type: ["string", "null"] },
  user_agent: { type: ["string", "null"] },
  ip: { type: ["string", "null"] },
  state: { type: ["string", "null"] },
  provider_user_id: text,
  settings: { type: "object" },
})

function nylasCall(context: ScenarioContext, path: string): Request {
  const key = context.target.credentials["key"]

  if (key === undefined)
    context.skip(`set ${NYLAS_KEY} to a Nylas API key to check the API's reads`)

  return new Request(`${NYLAS}${path}`, { headers: { authorization: `Bearer ${key}` } })
}

const nylasErrors: Scenario = {
  name: "errors: no key, unknown key",
  async run(context) {
    await context.step("list grants without a key", new Request(`${NYLAS}/v3/grants`), {
      literals: ["error.type"],
      doc: {
        schema: NYLAS_UNIDENTIFIED,
        status: 401,
        literals: { "error.type": "invalid_request_error" },
      },
    })
    await context.step(
      "list grants with a key Nylas never issued",
      new Request(`${NYLAS}/v3/grants`, {
        headers: { authorization: `Bearer ${["nyk_", "v0_danwoFidelity00000000"].join("")}` },
      }),
      {
        literals: ["error.type"],
        doc: {
          schema: NYLAS_ERROR,
          status: 401,
          literals: { "error.type": "api.invalid_request_error" },
        },
      },
    )
  },
}

const nylasGrants: Scenario = {
  name: "grants: list and read one",
  async run(context) {
    await context.step("list grants", nylasCall(context, "/v3/grants?limit=5"), {
      maps: ["data[].settings"],
      doc: {
        schema: object(["request_id", "data"], { request_id: text, data: list(GRANT) }),
        status: 200,
      },
    })
  },
}

export const nylasFidelity: FidelityProvider = {
  name: "nylas",
  leaves: "nothing: the suite only reads",
  credentials: [
    PUBLIC_ENDPOINTS,
    {
      name: NYLAS_KEY,
      description: "a Nylas application API key (nyk_…); runs only read",
      optional: true,
    },
  ],
  scenarios: [nylasErrors, nylasGrants],
  emulator: () =>
    emulatorTarget(nylas, { key: ["nyk_", "v0_danwo_fidelity"].join("") }, (emulator) =>
      seedNylas(emulator.store, {
        apiKeys: [["nyk_", "v0_danwo_fidelity"].join("")],
        grants: [
          { email: "fidelity@danwo.test" },
          { email: "fidelity2@danwo.test", provider: "microsoft" },
        ],
      }),
    ),
  live(env) {
    const key = env[NYLAS_KEY]?.trim()

    if (key) return liveTarget({ key })

    return publicEndpointsAllowed(env) ? liveTarget({}) : undefined
  },
}

/* --- Nango --- */

const NANGO = "https://api.nango.dev"
const NANGO_KEY = "DANWO_FIDELITY_NANGO_KEY"
const NANGO_ERROR = object(["error"], {
  error: object(["message", "code", "payload"], {
    message: text,
    code: text,
    payload: { type: "object" },
  }),
})

function nangoCall(context: ScenarioContext, path: string): Request {
  const key = context.target.credentials["key"]

  if (key === undefined)
    context.skip(`set ${NANGO_KEY} to a Nango environment's secret key to check its reads`)

  return new Request(`${NANGO}${path}`, { headers: { authorization: `Bearer ${key}` } })
}

const nangoErrors: Scenario = {
  name: "errors: no key, unknown key",
  async run(context) {
    await context.step("list connections without a key", new Request(`${NANGO}/connections`), {
      literals: ["error.code"],
      doc: { schema: NANGO_ERROR, status: 401, literals: { "error.code": "missing_auth_header" } },
    })
    await context.step(
      "list connections with a key Nango never issued",
      new Request(`${NANGO}/connections`, {
        headers: { authorization: "Bearer 00000000-0000-4000-8000-000000000000" },
      }),
      { doc: { schema: NANGO_ERROR, status: 401 } },
    )
  },
}

const nangoProject: Scenario = {
  name: "project: integrations and connections",
  async run(context) {
    await context.step("list integrations", nangoCall(context, "/integrations"), {
      doc: {
        schema: object(["data"], {
          data: list(
            object(["unique_key", "provider"], {
              unique_key: text,
              provider: text,
              display_name: text,
              logo: text,
              created_at: text,
              updated_at: text,
            }),
          ),
        }),
        status: 200,
      },
    })
    await context.step("list connections", nangoCall(context, "/connections"), {
      maps: ["connections[].metadata", "connections[].tags"],
      doc: {
        schema: object(["connections"], {
          connections: list(
            object(["id", "connection_id", "provider", "provider_config_key", "created"], {
              id: { type: "number" },
              connection_id: text,
              provider: text,
              provider_config_key: text,
              created: text,
              metadata: { type: "object" },
              errors: list({ type: "object" }),
              end_user: { type: ["object", "null"] },
              tags: { type: "object" },
            }),
          ),
        }),
        status: 200,
      },
    })
  },
}

export const nangoFidelity: FidelityProvider = {
  name: "nango",
  leaves: "nothing: the suite only reads",
  credentials: [
    PUBLIC_ENDPOINTS,
    {
      name: NANGO_KEY,
      description: "a Nango environment's secret key; runs only read",
      optional: true,
    },
  ],
  scenarios: [nangoErrors, nangoProject],
  emulator: () =>
    emulatorTarget(nango, { key: "danwo-fidelity-secret" }, (emulator) =>
      seedNango(emulator.store, {
        secretKeys: ["danwo-fidelity-secret"],
        integrations: [{ key: "hubspot", provider: "hubspot", name: "HubSpot" }],
        connections: [
          {
            integration: "hubspot",
            connectionId: "fidelity-1",
            endUser: { id: "u1", email: "ada@example.com", display_name: "Ada" },
          },
        ],
      }),
    ),
  live(env) {
    const key = env[NANGO_KEY]?.trim()

    if (key) return liveTarget({ key })

    return publicEndpointsAllowed(env) ? liveTarget({}) : undefined
  },
}

/* --- Unipile --- */

const UNIPILE_DSN = "DANWO_FIDELITY_UNIPILE_DSN"
const UNIPILE_KEY = "DANWO_FIDELITY_UNIPILE_KEY"
const PROBLEM = object(["status", "type", "title"], {
  status: { type: "number" },
  type: text,
  title: text,
  detail: text,
})

function unipileCall(context: ScenarioContext, path: string, token?: string): Request {
  const dsn = context.target.credentials["dsn"]
  const key = token ?? context.target.credentials["key"]

  if (dsn === undefined || key === undefined)
    context.skip(
      `set ${UNIPILE_DSN} and ${UNIPILE_KEY} to check Unipile's API, which lives on an account's DSN`,
    )

  return new Request(`https://${dsn}/api/v1${path}`, {
    headers: { "x-api-key": key, accept: "application/json" },
  })
}

const unipileErrors: Scenario = {
  name: "errors: unknown token",
  async run(context) {
    await context.step(
      "list accounts with a token Unipile never issued",
      unipileCall(context, "/accounts", "danwo-unknown-token"),
      {
        literals: ["status"],
        doc: { schema: PROBLEM, status: 401, literals: { status: 401 } },
      },
    )
  },
}

const unipileAccounts: Scenario = {
  name: "accounts: list",
  async run(context) {
    await context.step("list accounts", unipileCall(context, "/accounts?limit=5"), {
      literals: ["object"],
      maps: ["items[].connection_params"],
      doc: {
        schema: object(["object", "items", "cursor"], {
          object: text,
          items: list(
            object(["object", "type", "id", "name", "created_at", "sources"], {
              object: text,
              type: text,
              id: text,
              name: text,
              created_at: text,
              connection_params: { type: "object" },
              groups: list(text),
              sources: list(object(["id", "status"], { id: text, status: text })),
            }),
          ),
          cursor: {},
        }),
        status: 200,
        literals: { object: "AccountList" },
      },
    })
  },
}

export const unipileFidelity: FidelityProvider = {
  name: "unipile",
  leaves: "nothing: the suite only reads",
  credentials: [
    { name: UNIPILE_DSN, description: "an account's DSN (api8.unipile.com:13851)", optional: true },
    { name: UNIPILE_KEY, description: "a Unipile access token; runs only read", optional: true },
  ],
  scenarios: [unipileErrors, unipileAccounts],
  emulator: () =>
    emulatorTarget(
      unipile,
      { dsn: "api8.unipile.com:13851", key: "danwo-fidelity-token" },
      (emulator) =>
        seedUnipile(emulator.store, {
          tokens: ["danwo-fidelity-token"],
          accounts: [{ type: "LINKEDIN", name: "Fidelity", username: "fidelity" }],
        }),
    ),
  live(env) {
    const dsn = env[UNIPILE_DSN]?.trim()
    const key = env[UNIPILE_KEY]?.trim()

    return dsn && key ? liveTarget({ dsn, key }) : undefined
  },
}
