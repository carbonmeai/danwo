/**
 * Pusher Channels' fidelity suite, for an app's key: triggering an event (with and without the
 * channel info it can ask for), a batch, reading a channel and the occupied channels. Pusher
 * publishes no API description, so each answer's schema is the one its HTTP API reference gives.
 * Triggering into a channel nobody listens to changes nothing an app could see.
 */
import { pusher, pusherSignedQuery, seedPusher } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { bool, map, num, object } from "../schema.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const APP_ID = "DANWO_FIDELITY_PUSHER_APP_ID"
const KEY = "DANWO_FIDELITY_PUSHER_KEY"
const SECRET = "DANWO_FIDELITY_PUSHER_SECRET"
const CLUSTER = "DANWO_FIDELITY_PUSHER_CLUSTER"

const EMULATED = { appId: "1000002", key: "fidelity-key", secret: "fidelity-secret", cluster: "eu" }

/** A Channels API request, signed as the server SDKs sign one. */
function signed(
  context: ScenarioContext,
  method: string,
  path: string,
  query: Record<string, string> = {},
  body?: unknown,
): Request {
  const app = {
    key: credential(context.target, "key"),
    secret: credential(context.target, "secret"),
  }
  const text = body === undefined ? "" : JSON.stringify(body)
  const full = `/apps/${credential(context.target, "appId")}${path}`
  const params = pusherSignedQuery(app, method, full, text, new Date(), new URLSearchParams(query))
  const host = `api-${credential(context.target, "cluster")}.pusher.com`

  return new Request(`https://${host}${full}?${params.toString()}`, {
    method,
    ...(body !== undefined && { headers: { "content-type": "application/json" }, body: text }),
  })
}

const triggering: Scenario = {
  name: "events: trigger, with info, and a batch",
  async run(context) {
    const channel = context.tag

    await context.step(
      "trigger an event",
      signed(context, "POST", "/events", {}, { name: "checked", channels: [channel], data: "{}" }),
      {
        doc: { schema: object({}), status: 200 },
      },
    )
    await context.step(
      "trigger an event asking for its channel's subscriber count",
      signed(
        context,
        "POST",
        "/events",
        {},
        { name: "checked", channels: [channel], data: "{}", info: "subscription_count" },
      ),
      { maps: ["channels"], doc: { schema: object({ channels: map }), status: 200 } },
    )
    await context.step(
      "trigger a batch",
      signed(
        context,
        "POST",
        "/batch_events",
        {},
        {
          batch: [
            { name: "a", channel, data: "1" },
            { name: "b", channel, data: "2" },
          ],
        },
      ),
      { doc: { schema: object({}), status: 200 } },
    )
  },
}

const channels: Scenario = {
  name: "channels: one channel, and the occupied ones",
  async run(context) {
    await context.step(
      "read an empty channel",
      signed(context, "GET", `/channels/${context.tag}`, {
        info: "subscription_count",
      }),
      {
        literals: ["occupied"],
        doc: {
          schema: object({ occupied: bool }, { subscription_count: num }),
          status: 200,
          literals: { occupied: false },
        },
      },
    )
    await context.step(
      "list occupied channels",
      signed(context, "GET", "/channels", { filter_by_prefix: "danwo-fidelity-" }),
      {
        maps: ["channels"],
        doc: { schema: object({ channels: map }), status: 200 },
      },
    )
  },
}

export const pusherFidelity: FidelityProvider = {
  name: "pusher",
  leaves:
    "nothing persists: events are not stored, and a channel exists only while something is subscribed",
  credentials: [
    { name: APP_ID, description: "a Channels app's id (App Keys page)" },
    { name: KEY, description: "the app's key" },
    { name: SECRET, description: "the app's secret" },
    { name: CLUSTER, description: "the app's cluster, e.g. eu or mt1" },
  ],
  scenarios: [triggering, channels],
  emulator: () =>
    emulatorTarget(pusher, EMULATED, (emulator) =>
      seedPusher(emulator.store, {
        apps: [
          {
            id: EMULATED.appId,
            key: EMULATED.key,
            secret: EMULATED.secret,
            cluster: EMULATED.cluster,
          },
        ],
      }),
    ),
  live(env) {
    const found = requiredCredentials(this, env)

    if (found === undefined) return undefined

    return liveTarget({
      appId: found[APP_ID] ?? "",
      key: found[KEY] ?? "",
      secret: found[SECRET] ?? "",
      cluster: found[CLUSTER] ?? "",
    })
  },
}
