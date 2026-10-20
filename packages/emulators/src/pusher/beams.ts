/**
 * Pusher Beams on `<instance>.pushnotifications.pusher.com`: the server SDK's publishes to
 * interests and to users and its user deletion, and the device API browsers and phones register
 * through (devices, their interests, the user they belong to). Notifications are not pushed to a
 * real device; each publish is kept with the devices it would reach, for tests to read.
 */

import { HttpError } from "../errors.ts"
import { hs256Claims } from "../hs256.ts"
import type { App, Context } from "../http.ts"
import { asRecord, jsonObjectOf } from "../json.ts"
import type { Clock } from "../store.ts"
import type { BeamsDevice, BeamsInstance } from "./entities.ts"
import type { PusherStore } from "./store.ts"

/** Interest names Beams accepts. */
const INTEREST = /^[a-zA-Z0-9_\-=@,.;]{1,164}$/
/** The pattern Beams names when an interest does not match it. */
const INTEREST_PATTERN = String.raw`^[a-zA-Z0-9_\-=@,.;]+$`

export interface BeamsRouteContext {
  readonly app: App
  readonly objects: PusherStore
  readonly clock: Clock
}

/** Beams' error body, which the server SDK turns into `"<status> <error> - <description>"`. */
export function beamsError(
  c: Context,
  status: number,
  error: string,
  description: string,
): Response {
  return c.json({ error, description }, status)
}

function instanceOf(ctx: BeamsRouteContext, c: Context): BeamsInstance {
  const instance = ctx.objects.instances.get(c.req.param("instanceId"))

  if (instance === undefined)
    throw new HttpError(404, `Instance ${c.req.param("instanceId")} not found`)

  return instance
}

/** The instance a server SDK request names, after checking its secret key. */
function authorised(ctx: BeamsRouteContext, c: Context): BeamsInstance {
  const instance = instanceOf(ctx, c)

  if (c.req.header("authorization") !== `Bearer ${instance.secret_key}`)
    throw new HttpError(401, "Incorrect Secret Key")

  return instance
}

/** A publish's list of names, refused in the words Beams' request validation uses. */
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(422, `\`${field}\`: Expected array`)
  if (value.length === 0) throw new HttpError(422, `\`${field}\`: Array must have at least 1 items`)

  const index = value.findIndex((item) => typeof item !== "string")

  if (index !== -1) throw new HttpError(422, `\`${field}.${index}\`: Expected string`)

  return value
}

/** Refuses the first interest Beams would not accept, naming its place in the list. */
function checkInterests(names: readonly string[]): void {
  const index = names.findIndex((name) => !INTEREST.test(name))

  if (index !== -1)
    throw new HttpError(422, `\`interests.${index}\`: Does not match pattern '${INTEREST_PATTERN}'`)
}

/** The device a device API call names, in its instance. */
function deviceOf(ctx: BeamsRouteContext, c: Context): BeamsDevice {
  const instance = instanceOf(ctx, c)
  const device = ctx.objects.devices.get(c.req.param("deviceId"))

  if (device === undefined || device.instance_id !== instance.id)
    throw new HttpError(404, `Device ${c.req.param("deviceId")} not found`)

  return device
}

function publishRoutes(ctx: BeamsRouteContext): void {
  ctx.app.post("/publish_api/v1/instances/:instanceId/publishes/interests", async (c) => {
    const instance = authorised(ctx, c)
    const { interests, ...request } = await jsonObjectOf(c)
    const names = strings(interests, "interests")

    checkInterests(names)

    const publish = ctx.objects.publishes.add(
      {
        id: `pub_${ctx.objects.next()}`,
        instance_id: instance.id,
        interests: names,
        users: null,
        request,
        at: ctx.clock().toISOString(),
      },
      null,
    )

    return c.json({ publishId: publish.id })
  })

  ctx.app.post("/publish_api/v1/instances/:instanceId/publishes/users", async (c) => {
    const instance = authorised(ctx, c)
    const { users, ...request } = await jsonObjectOf(c)
    const publish = ctx.objects.publishes.add(
      {
        id: `pub_${ctx.objects.next()}`,
        instance_id: instance.id,
        interests: null,
        users: strings(users, "users"),
        request,
        at: ctx.clock().toISOString(),
      },
      null,
    )

    return c.json({ publishId: publish.id })
  })

  /* The server SDKs delete a user on `customer_api`; Beams answers the older `user_api` path too. */
  for (const api of ["customer_api", "user_api"])
    ctx.app.delete(`/${api}/v1/instances/:instanceId/users/:userId`, (c) => {
      const instance = authorised(ctx, c)

      for (const device of ctx.objects.devices.where(
        (found) => found.instance_id === instance.id && found.user_id === c.req.param("userId"),
      ))
        ctx.objects.devices.remove(device.id)

      return c.body(null, 200)
    })
}

function deviceRoutes(ctx: BeamsRouteContext): void {
  const base = "/device_api/v1/instances/:instanceId/devices/:platform"

  ctx.app.post(base, async (c) => {
    const instance = instanceOf(ctx, c)
    const body = await jsonObjectOf(c)
    const platform = c.req.param("platform")

    if (platform !== "web" && platform !== "fcm" && platform !== "apns")
      throw new HttpError(404, `Unknown platform ${platform}`)

    const device = ctx.objects.devices.add(
      {
        id: `${platform}-${ctx.objects.next()}`,
        instance_id: instance.id,
        platform,
        token: body["token"] ?? body["webPushSubscription"] ?? null,
        interests: [],
        user_id: null,
        metadata: asRecord(body["metadata"]) ?? {},
      },
      null,
    )

    return c.json({ id: device.id, initialInterestSet: [] })
  })

  ctx.app.get(`${base}/:deviceId/interests`, (c) =>
    c.json({ interests: deviceOf(ctx, c).interests, responseMetadata: {} }),
  )

  ctx.app.put(`${base}/:deviceId/interests`, async (c) => {
    const device = deviceOf(ctx, c)
    const interests = (await jsonObjectOf(c))["interests"]

    ctx.objects.devices.change(device.id, {
      interests: Array.isArray(interests)
        ? interests.filter((name): name is string => typeof name === "string")
        : [],
    })

    return c.body(null, 200)
  })

  ctx.app.post(`${base}/:deviceId/interests/:interest`, (c) => {
    const device = deviceOf(ctx, c)
    const interest = c.req.param("interest")

    if (!INTEREST.test(interest)) throw new HttpError(422, "Invalid interest name")
    if (!device.interests.includes(interest))
      ctx.objects.devices.change(device.id, { interests: [...device.interests, interest] })

    return c.body(null, 200)
  })

  ctx.app.delete(`${base}/:deviceId/interests/:interest`, (c) => {
    const device = deviceOf(ctx, c)

    ctx.objects.devices.change(device.id, {
      interests: device.interests.filter((name) => name !== c.req.param("interest")),
    })

    return c.body(null, 200)
  })

  ctx.app.put(`${base}/:deviceId/user`, (c) => {
    const device = deviceOf(ctx, c)
    const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1]
    const userId = token === undefined ? undefined : subjectOf(token, instanceOf(ctx, c))

    if (userId === undefined) throw new HttpError(401, "Missing or invalid Beams token")

    ctx.objects.devices.change(device.id, { user_id: userId })

    return c.body(null, 200)
  })

  ctx.app.delete(`${base}/:deviceId`, (c) => {
    ctx.objects.devices.remove(deviceOf(ctx, c).id)

    return c.body(null, 200)
  })
}

/**
 * The `sub` of a Beams token: an HS256 JWT the app's server signs with the instance's secret key
 * (the server SDK's `generateToken`), issued for this instance. Undefined when it is not one.
 */
function subjectOf(token: string, instance: BeamsInstance): string | undefined {
  const claims = hs256Claims(token, instance.secret_key)
  const sub = claims?.["sub"]

  if (claims?.["iss"] !== `https://${instance.id}.pushnotifications.pusher.com`) return undefined

  return typeof sub === "string" ? sub : undefined
}

export function beamsRoutes(ctx: BeamsRouteContext): void {
  publishRoutes(ctx)
  deviceRoutes(ctx)
}
