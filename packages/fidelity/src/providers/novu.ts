/**
 * Novu's fidelity suite: an unknown key's error, which needs no key (with the public opt-in), and
 * with a development environment's secret key a subscriber's life (create, read, patch, delete)
 * and a topic. Novu has no test mode, so the key belongs to a development environment; the
 * suite deletes the subscriber it made. Answers are checked against the schemas `@novu/api` reads.
 */
import { novu, seedNovu } from "@danwo/emulators"

import { type FidelityProvider, PUBLIC_ENDPOINTS } from "../provider.ts"
import type { Scenario, ScenarioContext, Target } from "../scenario.ts"
import { anything, bool, map, nullable, num, object, str } from "../schema.ts"
import { asJsonObject, isJsonArray, readJson } from "../shape.ts"
import { isTagged, type Leftover, SweepUnavailable } from "../sweep.ts"
import { emulatorTarget, keyOrPublicTarget } from "../target.ts"

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
    const id = context.tag
    /* Built first: without a key it skips the scenario before anything is written down. */
    const create = call(context, "POST", "/v2/subscribers", { subscriberId: id, firstName: "Ada" })

    context.created({
      kind: "subscriber",
      id,
      undo: () => context.target.send(call(context, "DELETE", `/v2/subscribers/${id}`)),
    })
    await context.step("create a subscriber", create, {
      literals: ["data.firstName"],
      maps: ["data.data"],
      doc: { schema: object({ data: SUBSCRIBER }), status: 201 },
    })
    await context.step("read it", call(context, "GET", `/v2/subscribers/${id}`), {
      maps: ["data.data"],
      doc: { schema: object({ data: SUBSCRIBER }), status: 200 },
    })
    await context.step(
      "patch it",
      call(context, "PATCH", `/v2/subscribers/${id}`, { lastName: "Lovelace" }),
      {
        literals: ["data.lastName"],
        maps: ["data.data"],
        doc: { schema: object({ data: SUBSCRIBER }), status: 200 },
      },
    )
    await context.step("delete it", call(context, "DELETE", `/v2/subscribers/${id}`), {
      literals: ["data.acknowledged", "data.status"],
      doc: { schema: object({ data: object({ acknowledged: bool, status: str }) }), status: 200 },
    })
  },
}

/** A request to Novu's API with an explicit key, for the sweep, which runs outside a scenario. */
function keyed(key: string, method: string, path: string): Request {
  return new Request(`${API}${path}`, { method, headers: { authorization: `ApiKey ${key}` } })
}

/** One page of subscribers: their ids, and the cursor of the next page when there is one. */
async function subscriberPage(
  target: Target,
  key: string,
  after: string | undefined,
): Promise<{ ids: string[]; next: string | undefined }> {
  const cursor = after === undefined ? "" : `&after=${after}`
  const body = asJsonObject(
    await readJson(await target.send(keyed(key, "GET", `/v2/subscribers?limit=100${cursor}`))),
  )
  const data = body?.["data"]
  const ids = (data !== undefined && isJsonArray(data) ? data : []).flatMap((item) => {
    const id = asJsonObject(item)?.["subscriberId"]

    return typeof id === "string" ? [id] : []
  })
  const next = body?.["next"]

  return { ids, next: typeof next === "string" && next !== "" ? next : undefined }
}

/** Subscribers earlier runs left: their ids carry the fidelity tag. Each is deleted. */
async function sweepSubscribers(target: Target): Promise<Leftover[]> {
  const key = target.credentials["key"]

  if (key === undefined) throw new SweepUnavailable(`set ${KEY} to list subscribers`)

  const ids: string[] = []
  let after: string | undefined

  for (let page = 0; page < 20; page++) {
    const found = await subscriberPage(target, key, after)

    ids.push(...found.ids)
    after = found.next
    if (after === undefined) break
  }

  return ids.filter(isTagged).map((id) => ({
    kind: "subscriber",
    id,
    label: id,
    tagged: true,
    remove: () => target.send(keyed(key, "DELETE", `/v2/subscribers/${id}`)),
  }))
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
  sweep: sweepSubscribers,
  emulator: () =>
    emulatorTarget(novu, { key: EMULATED_KEY }, (emulator) =>
      seedNovu(emulator.store, { apiKey: EMULATED_KEY }),
    ),
  live: (env) => keyOrPublicTarget(env, KEY),
}
