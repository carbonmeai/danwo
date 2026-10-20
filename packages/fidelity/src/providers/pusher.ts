/**
 * Pusher's fidelity suite, for a Channels app's key: triggering events (one, and a batch), reading
 * a channel, the occupied channels and presence user counts, the subscription counts an app
 * reports once subscription counting is on in its settings (and the refusals while it is off),
 * and, with a Beams instance, publishing to an interest and a user nobody has registered. Pusher
 * publishes no API description, so each answer's schema is the one its HTTP API reference gives.
 * Triggering into a channel nobody listens to, or publishing to an interest no device has, changes
 * nothing an app or a person could see.
 */
import { pusher, pusherSignedQuery, seedPusher } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Answer, Fact, Scenario, ScenarioContext } from "../scenario.ts"
import { arrayOf, bool, map, num, object, str } from "../schema.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const APP_ID = "DANWO_FIDELITY_PUSHER_APP_ID"
const KEY = "DANWO_FIDELITY_PUSHER_KEY"
const SECRET = "DANWO_FIDELITY_PUSHER_SECRET"
const CLUSTER = "DANWO_FIDELITY_PUSHER_CLUSTER"
const BEAMS_INSTANCE = "DANWO_FIDELITY_PUSHER_BEAM_INSTANCE_ID"
const BEAMS_SECRET = "DANWO_FIDELITY_PUSHER_BEAM_SECRET_KEY"

/** The emulator's apps: one with subscription counting on, one with it off, and a Beams instance. */
const EMULATED = {
  appId: "1000002",
  key: "fidelity-key",
  secret: "fidelity-secret",
  cluster: "eu",
  uncountedAppId: "1000003",
  uncountedKey: "fidelity-uncounted-key",
  uncountedSecret: "fidelity-uncounted-secret",
  beamsInstance: "fidelity-beams",
  beamsSecret: "fidelity-beams-secret",
}

const COUNTING_OFF =
  "Cannot retrieve the subscription count because subscription counting is not enabled\n"
const USERS_ON_PRESENCE_ONLY =
  "Cannot retrieve the user count unless the channel is a presence channel\n"
const USERS_NEED_PRESENCE_PREFIX =
  "user_count may only be requested for presence channels - please supply filter_by_prefix begining with presence-\n"

/** Which app a request is signed for: the one that keeps subscription counts, or the one that does not. */
type AppChoice = "counted" | "uncounted"

/** The app id, key and secret a request is signed with, on this target. */
function appOf(context: ScenarioContext, choice: AppChoice) {
  const own = context.target.kind === "live" || choice === "counted"

  return {
    id: credential(context.target, own ? "appId" : "uncountedAppId"),
    key: credential(context.target, own ? "key" : "uncountedKey"),
    secret: credential(context.target, own ? "secret" : "uncountedSecret"),
  }
}

/** A Channels API request, signed as the server SDKs sign one. */
function signed(
  context: ScenarioContext,
  method: string,
  path: string,
  query: Record<string, string> = {},
  body?: unknown,
  choice: AppChoice = "counted",
): Request {
  const app = appOf(context, choice)
  const text = body === undefined ? "" : JSON.stringify(body)
  const full = `/apps/${app.id}${path}`
  const params = pusherSignedQuery(app, method, full, text, new Date(), new URLSearchParams(query))
  const host = `api-${credential(context.target, "cluster")}.pusher.com`

  return new Request(`https://${host}${full}?${params.toString()}`, {
    method,
    ...(body !== undefined && { headers: { "content-type": "application/json" }, body: text }),
  })
}

/** Records a plain-text refusal's wording, which the SDKs pass on as the error's message. */
function refusal(context: ScenarioContext, name: string, answer: Answer): void {
  context.fact(name, typeof answer.body === "string" ? answer.body : null)
}

/** A trigger of one event into `channel`, with an optional `info` request. */
function trigger(channel: string, info?: string) {
  return { name: "checked", channels: [channel], data: "{}", ...(info && { info }) }
}

const triggering: Scenario = {
  name: "events: trigger, a batch, and presence user counts",
  async run(context) {
    const channel = context.tag
    const presence = `presence-${context.tag}`

    await context.step(
      "trigger an event",
      signed(context, "POST", "/events", {}, trigger(channel)),
      {
        doc: { schema: object({}), status: 200 },
      },
    )
    await context.step(
      "trigger an event asking for a user count on a channel that is not a presence channel",
      signed(context, "POST", "/events", {}, trigger(channel, "user_count")),
      { maps: ["channels"], doc: { schema: object({ channels: map }), status: 200 } },
    )
    await context.step(
      "trigger an event asking for a presence channel's user count",
      signed(context, "POST", "/events", {}, trigger(presence, "user_count")),
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
  name: "channels: one channel, the occupied ones, and user counts",
  documentedFacts: [
    {
      name: "a user count on a channel that is not a presence channel",
      value: USERS_ON_PRESENCE_ONLY,
    },
    {
      name: "a user count on a list without the presence prefix",
      value: USERS_NEED_PRESENCE_PREFIX,
    },
  ],
  async run(context) {
    const presence = `presence-${context.tag}`

    await context.step(
      "read an empty channel",
      signed(context, "GET", `/channels/${context.tag}`),
      {
        literals: ["occupied"],
        doc: { schema: object({ occupied: bool }), status: 200, literals: { occupied: false } },
      },
    )
    await context.step(
      "read a presence channel's user count",
      signed(context, "GET", `/channels/${presence}`, { info: "user_count" }),
      {
        literals: ["occupied"],
        doc: {
          schema: object({ occupied: bool, user_count: num }),
          status: 200,
          literals: { occupied: false },
        },
      },
    )
    refusal(
      context,
      "a user count on a channel that is not a presence channel",
      await context.step(
        "ask for a user count on a channel that is not a presence channel",
        signed(context, "GET", `/channels/${context.tag}`, { info: "user_count" }),
        { doc: { schema: str, status: 400 } },
      ),
    )
    await context.step(
      "list occupied channels",
      signed(context, "GET", "/channels", { filter_by_prefix: "danwo-fidelity-" }),
      { maps: ["channels"], doc: { schema: object({ channels: map }), status: 200 } },
    )
    refusal(
      context,
      "a user count on a list without the presence prefix",
      await context.step(
        "ask for user counts on a list without the presence prefix",
        signed(context, "GET", "/channels", { info: "user_count" }),
        { doc: { schema: str, status: 400 } },
      ),
    )
  },
}

/** Whether the target's app reports subscription counts, asked without recording the answer. */
async function countingOn(context: ScenarioContext, choice: AppChoice): Promise<boolean> {
  const probe = signed(
    context,
    "GET",
    `/channels/${context.tag}`,
    {
      info: "subscription_count",
    },
    undefined,
    choice,
  )

  return (await context.target.send(probe)).status === 200
}

/** The four requests that can carry a subscription count, signed for `choice`'s app. */
function countRequests(context: ScenarioContext, choice: AppChoice) {
  const channel = context.tag

  return {
    trigger: signed(context, "POST", "/events", {}, trigger(channel, "subscription_count"), choice),
    batch: signed(
      context,
      "POST",
      "/batch_events",
      {},
      { batch: [{ name: "a", channel, data: "1", info: "subscription_count" }] },
      choice,
    ),
    read: signed(
      context,
      "GET",
      `/channels/${channel}`,
      { info: "subscription_count" },
      undefined,
      choice,
    ),
    list: signed(
      context,
      "GET",
      "/channels",
      { filter_by_prefix: "danwo-fidelity-", info: "subscription_count" },
      undefined,
      choice,
    ),
  }
}

const counted: Scenario = {
  name: "subscription counts: with counting on",
  async run(context) {
    if (!(await countingOn(context, "counted")))
      context.skip(
        "subscription counting is off on this app: turn on Enable subscription counting in the app's settings to check these answers",
      )

    const requests = countRequests(context, "counted")

    await context.step(
      "trigger an event asking for its channel's subscription count",
      requests.trigger,
      {
        maps: ["channels"],
        doc: { schema: object({ channels: map }), status: 200 },
      },
    )
    await context.step("trigger a batch asking for subscription counts", requests.batch, {
      doc: { schema: object({ batch: arrayOf(object({ subscription_count: num })) }), status: 200 },
    })
    await context.step("read a channel's subscription count", requests.read, {
      literals: ["occupied"],
      doc: {
        schema: object({ occupied: bool, subscription_count: num }),
        status: 200,
        literals: { occupied: false },
      },
    })
    await context.step("list channels with their subscription counts", requests.list, {
      maps: ["channels"],
      doc: { schema: object({ channels: map }), status: 200 },
    })
  },
}

/** The fact a refusal of a subscription count is recorded under. */
const COUNTING_OFF_FACT = (where: string): Fact => ({
  name: `a subscription count ${where}`,
  value: COUNTING_OFF,
})

const uncounted: Scenario = {
  name: "subscription counts: with counting off",
  documentedFacts: [
    COUNTING_OFF_FACT("on a trigger"),
    COUNTING_OFF_FACT("on a batch"),
    COUNTING_OFF_FACT("on a channel"),
  ],
  async run(context) {
    if (await countingOn(context, "uncounted"))
      context.skip(
        "subscription counting is on on this app: these answers are for an app with it off",
      )

    const requests = countRequests(context, "uncounted")
    const plainRefusal = { doc: { schema: str, status: 400 } }

    refusal(
      context,
      "a subscription count on a trigger",
      await context.step(
        "trigger an event asking for a subscription count",
        requests.trigger,
        plainRefusal,
      ),
    )
    refusal(
      context,
      "a subscription count on a batch",
      await context.step(
        "trigger a batch asking for subscription counts",
        requests.batch,
        plainRefusal,
      ),
    )
    refusal(
      context,
      "a subscription count on a channel",
      await context.step("read a channel's subscription count", requests.read, plainRefusal),
    )
    await context.step("list channels asking for subscription counts", requests.list, {
      maps: ["channels"],
      doc: { schema: object({ channels: map }), status: 200 },
    })
  },
}

/** A Beams server API request, authorised with the instance's secret key. */
function beams(
  context: ScenarioContext,
  method: string,
  path: string,
  body?: unknown,
  secret?: string,
): Request {
  const instance = context.target.credentials["beamsInstance"]
  const key = secret ?? context.target.credentials["beamsSecret"]

  if (instance === undefined || key === undefined)
    context.skip(`set ${BEAMS_INSTANCE} and ${BEAMS_SECRET} to check Beams`)

  return new Request(
    `https://${instance}.pushnotifications.pusher.com${path.replace(":instance", instance)}`,
    {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    },
  )
}

const BEAMS_ERROR = object({ error: str, description: str })

/** How a Beams refusal is compared: its `error` word exactly, its description by shape. */
function refused(status: number) {
  return { literals: ["error"], doc: { schema: BEAMS_ERROR, status } }
}

/** A notification for a browser, published where no device is registered, so it reaches no one. */
const UNSEEN = { web: { notification: { title: "danwo fidelity", body: "reaches no device" } } }

const publishing: Scenario = {
  name: "beams: publish to an interest and a user nobody registered, and refusals",
  async run(context) {
    const interests = "/publish_api/v1/instances/:instance/publishes/interests"
    const published = { doc: { schema: object({ publishId: str }), status: 200 } }

    await context.step(
      "publish to an interest no device has",
      beams(context, "POST", interests, { interests: [context.tag], ...UNSEEN }),
      published,
    )
    await context.step(
      "publish to a user with no devices",
      beams(context, "POST", "/publish_api/v1/instances/:instance/publishes/users", {
        users: [context.tag],
        ...UNSEEN,
      }),
      published,
    )
    await context.step(
      "publish to an interest whose name Beams refuses",
      beams(context, "POST", interests, { interests: ["not allowed!"], ...UNSEEN }),
      refused(422),
    )
    await context.step(
      "publish to no interests",
      beams(context, "POST", interests, { interests: [], ...UNSEEN }),
      refused(422),
    )
    await context.step(
      "publish with the wrong secret key",
      beams(context, "POST", interests, { interests: [context.tag], ...UNSEEN }, "wrong"),
      refused(401),
    )
    await context.step(
      "delete the user nobody registered",
      beams(context, "DELETE", `/customer_api/v1/instances/:instance/users/${context.tag}`),
      { doc: { schema: { type: "null" }, status: 200 } },
    )
  },
}

export const pusherFidelity: FidelityProvider = {
  name: "pusher",
  leaves:
    "nothing persists: events are not stored, a channel exists only while something is subscribed, and publishes go to interests and users no device has",
  credentials: [
    { name: APP_ID, description: "a Channels app's id (App Keys page)" },
    { name: KEY, description: "the app's key" },
    { name: SECRET, description: "the app's secret" },
    { name: CLUSTER, description: "the app's cluster, e.g. eu or mt1" },
    { name: BEAMS_INSTANCE, description: "a Beams instance's id", optional: true },
    { name: BEAMS_SECRET, description: "the Beams instance's secret key", optional: true },
  ],
  scenarios: [triggering, channels, counted, uncounted, publishing],
  emulator: () =>
    emulatorTarget(pusher, EMULATED, (emulator) =>
      seedPusher(emulator.store, {
        apps: [
          {
            id: EMULATED.appId,
            key: EMULATED.key,
            secret: EMULATED.secret,
            cluster: EMULATED.cluster,
            subscriptionCounting: true,
          },
          {
            id: EMULATED.uncountedAppId,
            key: EMULATED.uncountedKey,
            secret: EMULATED.uncountedSecret,
            cluster: EMULATED.cluster,
          },
        ],
        beams: [{ instanceId: EMULATED.beamsInstance, secretKey: EMULATED.beamsSecret }],
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
      ...(found[BEAMS_INSTANCE] !== undefined && { beamsInstance: found[BEAMS_INSTANCE] }),
      ...(found[BEAMS_SECRET] !== undefined && { beamsSecret: found[BEAMS_SECRET] }),
    })
  },
}
