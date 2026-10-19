/**
 * Novu's fidelity suite: an unknown key's error, which needs no key (with the public opt-in), and
 * with a development environment's secret key a subscriber's life (create, read, patch, delete)
 * and a topic. Novu has no test mode, so the key belongs to a development environment; the
 * suite deletes the subscriber it made. Answers are checked against the schemas `@novu/api` reads.
 */
import { novu, seedNovu } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS, publicEndpointsAllowed } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { anything, bool, map, nullable, num, object, str } from "../schema.ts"
import { emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.novu.co"
const KEY = "DANWO_FIDELITY_NOVU_KEY"
const EMULATED_KEY = "danwo-fidelity-novu"

const ERROR = object(
  { statusCode: num, message: str, error: str, timestamp: str, path: str },
  { ctx: object({ statusCode: num, error: str }) },
)

const SUBSCRIBER = object(
  {
    subscriberId: str,
    _organizationId: str,
    _environmentId: str,
    deleted: bool,
    createdAt: str,
    updatedAt: str,
  },
  {
    _id: str,
    firstName: nullable(str),
    lastName: nullable(str),
    email: nullable(str),
    phone: nullable(str),
    avatar: nullable(str),
    locale: nullable(str),
    timezone: nullable(str),
    data: nullable(map),
    channels: anything,
    isOnline: nullable(bool),
    lastOnlineAt: nullable(str),
    __v: num,
  },
)

function call(context: ScenarioContext, method: string, path: string, body?: unknown): Request {
  const key = context.target.credentials["key"]

  if (key === undefined) context.skip(`set ${KEY} to a development environment's secret key`)

  return new Request(`${API}${path}`, {
    method,
    headers: { authorization: `ApiKey ${key}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}

const errors: Scenario = {
  name: "errors: an unknown key",
  async run(context) {
    await context.step(
      "read subscribers with a key Novu never issued",
      new Request(`${API}/v2/subscribers`, {
        headers: { authorization: "ApiKey danwo-fidelity-unknown" },
      }),
      {
        literals: ["statusCode", "error", "message"],
        doc: {
          schema: ERROR,
          status: 401,
          literals: { statusCode: 401, error: "Unauthorized", message: "API Key not found" },
        },
      },
    )
  },
}

const subscribers: Scenario = {
  name: "subscribers: create, read, patch, delete",
  async run(context) {
    const id = `danwo-fidelity-${context.unique}`

    await context.step(
      "create a subscriber",
      call(context, "POST", "/v2/subscribers", { subscriberId: id, firstName: "Ada" }),
      {
        literals: ["subscriberId", "firstName"],
        maps: ["data"],
        doc: { schema: SUBSCRIBER, status: 201 },
      },
    )
    await context.step("read it", call(context, "GET", `/v2/subscribers/${id}`), {
      maps: ["data"],
      doc: { schema: SUBSCRIBER, status: 200 },
    })
    await context.step(
      "patch it",
      call(context, "PATCH", `/v2/subscribers/${id}`, { lastName: "Lovelace" }),
      {
        literals: ["lastName"],
        maps: ["data"],
        doc: { schema: SUBSCRIBER, status: 200 },
      },
    )
    await context.step("delete it", call(context, "DELETE", `/v2/subscribers/${id}`), {
      literals: ["acknowledged", "status"],
      doc: { schema: object({ acknowledged: bool, status: str }), status: 200 },
    })
  },
}

export const novuFidelity: FidelityProvider = {
  name: "novu",
  credentials: [
    PUBLIC_ENDPOINTS,
    {
      name: KEY,
      description:
        "a development environment's secret key; the suite creates and deletes one subscriber",
      optional: true,
    },
  ],
  scenarios: [errors, subscribers],
  emulator: () =>
    emulatorTarget(novu, { key: EMULATED_KEY }, (emulator) =>
      seedNovu(emulator.store, { apiKey: EMULATED_KEY }),
    ),
  live(env) {
    const key = env[KEY]?.trim()

    if (key !== undefined && key !== "") return liveTarget({ key })

    return publicEndpointsAllowed(env) ? liveTarget({}) : undefined
  },
}
