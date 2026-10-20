import { createHmac } from "node:crypto"
import { once } from "node:events"
import { createRequire } from "node:module"

import PusherServer from "pusher"
import type {
  Channel,
  ChannelAuthorizationHandler,
  ConnectionManager,
  Options as PusherClientOptions,
} from "pusher-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { serve } from "../src/http.ts"
import {
  createEmulator,
  type Emulator,
  pusher,
  pusherChannels,
  seedPusher,
  serveSockets,
  type SocketServer,
} from "../src/index.ts"
import { listeningPort } from "../src/net.ts"

/*
 * pusher-js's CommonJS build exports its class itself, which its type declarations call the
 * module's default export; loading it with require gives the class at runtime and in the types.
 */
interface PusherClient {
  readonly connection: ConnectionManager
  subscribe(channel: string): Channel
  disconnect(): void
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above: the declared and the real shape of the module differ
const PusherClient = createRequire(import.meta.url)("pusher-js") as new (
  key: string,
  options: PusherClientOptions,
) => PusherClient

const APP = { id: "4242", key: "app-key", secret: "app-secret", cluster: "eu" }

let emulator: Emulator
let api: ReturnType<typeof serve>
let sockets: SocketServer
let clients: PusherClient[]

/** The server SDK, pointed at the emulator's HTTP port. */
function server(): PusherServer {
  const port = listeningPort(api)

  return new PusherServer({
    appId: APP.id,
    key: APP.key,
    secret: APP.secret,
    host: "127.0.0.1",
    port: String(port),
    useTLS: false,
  })
}

/** Hands the client an authorisation the emulator must refuse. */
const refuse: ChannelAuthorizationHandler = (_request, callback) =>
  callback(null, { auth: `${APP.key}:bad` })

/** Authorises channels for `user` the way the app's auth endpoint would, with the server SDK. */
function authorise(signer: PusherServer, user: string): ChannelAuthorizationHandler {
  return ({ socketId, channelName }, callback) =>
    callback(
      null,
      channelName.startsWith("presence-")
        ? signer.authorizeChannel(socketId, channelName, {
            user_id: user,
            user_info: { name: user },
          })
        : signer.authorizeChannel(socketId, channelName),
    )
}

/** `pusher-js` connected to the emulator's sockets, authorising channels as the app's server would. */
function client(user = "u1"): PusherClient {
  const port = Number(new URL(sockets.url).port)
  const signer = server()
  const connection = new PusherClient(APP.key, {
    cluster: APP.cluster,
    wsHost: "127.0.0.1",
    wsPort: port,
    forceTLS: false,
    enabledTransports: ["ws"],
    channelAuthorization: {
      endpoint: "",
      transport: "ajax",
      customHandler: authorise(signer, user),
    },
  })

  clients.push(connection)

  return connection
}

async function connected(connection: PusherClient): Promise<void> {
  if (connection.connection.state === "connected") return
  await new Promise<void>((resolve) => connection.connection.bind("connected", () => resolve()))
}

async function subscribed(connection: PusherClient, name: string) {
  const channel = connection.subscribe(name)

  await new Promise<void>((resolve, reject) => {
    channel.bind("pusher:subscription_succeeded", () => resolve())
    channel.bind("pusher:subscription_error", (error: unknown) =>
      reject(new Error(JSON.stringify(error))),
    )
  })

  return channel
}

beforeEach(async () => {
  emulator = createEmulator(pusher)
  seedPusher(emulator.store, { apps: [APP] })
  api = serve({ fetch: emulator.fetch, port: 0 })
  await once(api, "listening")
  if (!emulator.connect) throw new Error("the Pusher emulator answers sockets")
  sockets = await serveSockets(emulator.connect)
  clients = []
})

afterEach(async () => {
  for (const connection of clients) connection.disconnect()
  await sockets.close()
  await new Promise((resolve) => api.close(resolve))
  await emulator.close()
})

describe("pusher channels", () => {
  it("delivers an event the server SDK triggers to a subscribed pusher-js client", async () => {
    const connection = client()

    await connected(connection)

    const channel = await subscribed(connection, "orders")
    const received = new Promise((resolve) => channel.bind("order.paid", resolve))

    await server().trigger("orders", "order.paid", { id: "o_1" })

    expect(await received).toEqual({ id: "o_1" })

    const [event] = pusherChannels(emulator).events({ channel: "orders" })

    expect(event).toMatchObject({ name: "order.paid", source: "api", data: '{"id":"o_1"}' })
    expect(event?.delivered_to).toEqual([connection.connection.socket_id])
  })

  it("leaves out the socket a trigger excludes, and batches", async () => {
    const first = client()
    const second = client()

    await Promise.all([connected(first), connected(second)])
    await Promise.all([subscribed(first, "feed"), subscribed(second, "feed")])
    await server().trigger("feed", "posted", "hello", { socket_id: first.connection.socket_id })
    await server().triggerBatch([
      { channel: "feed", name: "a", data: "1" },
      { channel: "feed", name: "b", data: "2" },
    ])

    const events = pusherChannels(emulator).events({ channel: "feed" })

    expect(events.map((event) => event.name)).toEqual(["posted", "a", "b"])
    expect(events[0]?.delivered_to).toEqual([second.connection.socket_id])
  })

  it("authorises private and presence channels and lists presence members", async () => {
    seedPusher(emulator.store, { apps: [{ ...APP, subscriptionCounting: true }] })

    const alice = client("alice")
    const bob = client("bob")

    await Promise.all([connected(alice), connected(bob)])
    await subscribed(alice, "private-team")
    await subscribed(alice, "presence-room")
    await subscribed(bob, "presence-room")

    const users = await server().get({ path: "/channels/presence-room/users" })
    const info = await server().get({
      path: "/channels/presence-room",
      params: { info: "user_count,subscription_count" },
    })

    expect(await users.json()).toEqual({ users: [{ id: "alice" }, { id: "bob" }] })
    expect(await info.json()).toEqual({ occupied: true, user_count: 2, subscription_count: 2 })
  })

  it("refuses subscription counts while the app has subscription counting off", async () => {
    const refused = {
      status: 400,
      body: "Cannot retrieve the subscription count because subscription counting is not enabled\n",
    }

    await expect(
      server().get({ path: "/channels/feed", params: { info: "subscription_count" } }),
    ).rejects.toMatchObject(refused)
    await expect(
      server().trigger("feed", "posted", "{}", { info: "subscription_count" }),
    ).rejects.toMatchObject(refused)
    await expect(
      server().triggerBatch([
        { channel: "feed", name: "a", data: "1", info: "subscription_count" },
      ]),
    ).rejects.toMatchObject(refused)
    expect(pusherChannels(emulator).events({ channel: "feed" })).toEqual([])

    const listed = await server().get({ path: "/channels", params: { info: "subscription_count" } })

    expect(await listed.json()).toEqual({ channels: {} })
  })

  it("reports subscription counts once the app turns counting on", async () => {
    seedPusher(emulator.store, { apps: [{ ...APP, subscriptionCounting: true }] })

    const listener = client()

    await connected(listener)
    await subscribed(listener, "feed")

    const triggered = await server().trigger("feed", "posted", "{}", {
      info: "subscription_count",
    })
    const read = await server().get({
      path: "/channels/feed",
      params: { info: "subscription_count" },
    })

    expect(await triggered.json()).toEqual({ channels: { feed: { subscription_count: 1 } } })
    expect(await read.json()).toEqual({ occupied: true, subscription_count: 1 })
  })

  it("refuses a user count on a channel that is not a presence channel", async () => {
    await expect(
      server().get({ path: "/channels/feed", params: { info: "user_count" } }),
    ).rejects.toMatchObject({
      status: 400,
      body: "Cannot retrieve the user count unless the channel is a presence channel\n",
    })
    await expect(
      server().get({ path: "/channels", params: { info: "user_count" } }),
    ).rejects.toMatchObject({
      status: 400,
      body: "user_count may only be requested for presence channels - please supply filter_by_prefix begining with presence-\n",
    })

    const ignored = await server().trigger("feed", "posted", "{}", { info: "user_count" })

    expect(await ignored.json()).toEqual({ channels: { feed: {} } })
  })

  it("refuses a private channel with a bad signature", async () => {
    const port = Number(new URL(sockets.url).port)
    const connection = new PusherClient(APP.key, {
      cluster: APP.cluster,
      wsHost: "127.0.0.1",
      wsPort: port,
      forceTLS: false,
      enabledTransports: ["ws"],
      channelAuthorization: {
        endpoint: "",
        transport: "ajax",
        customHandler: refuse,
      },
    })

    clients.push(connection)
    await connected(connection)

    const error = new Promise<{ message?: string }>((resolve) =>
      connection.connection.bind("error", (event: { data?: { message?: string } }) =>
        resolve(event.data ?? {}),
      ),
    )

    connection.subscribe("private-secret")

    expect((await error).message).toMatch(/^Invalid signature/)
  })

  it("rejects a request signed with the wrong secret", async () => {
    const port = listeningPort(api)
    const wrong = new PusherServer({
      appId: APP.id,
      key: APP.key,
      secret: "nope",
      host: "127.0.0.1",
      port: String(port),
      useTLS: false,
    })

    await expect(wrong.trigger("orders", "x", {})).rejects.toMatchObject({ status: 401 })
  })

  it("relays client events on private channels to the other members", async () => {
    const alice = client("alice")
    const bob = client("bob")

    await Promise.all([connected(alice), connected(bob)])

    const mine = await subscribed(alice, "private-chat")
    const theirs = await subscribed(bob, "private-chat")
    const heard = new Promise((resolve) => theirs.bind("client-typing", resolve))

    mine.trigger("client-typing", { typing: true })

    expect(await heard).toEqual({ typing: true })
    expect(pusherChannels(emulator).events({ source: "client" })).toHaveLength(1)
  })

  it("closes connections on reset, and clients reconnect", async () => {
    const connection = client()

    await connected(connection)

    const states: string[] = []

    connection.connection.bind("state_change", ({ current }: { current: string }) =>
      states.push(current),
    )
    emulator.reset()
    seedPusher(emulator.store, { apps: [APP] })
    await new Promise<void>((resolve) => connection.connection.bind("connected", () => resolve()))

    expect(states).toContain("connecting")
  })

  it("signs webhooks with the app's secret", async () => {
    const received: { body: string; signature: string | null }[] = []
    const hooks = serve({
      port: 0,
      fetch: async (request) => {
        received.push({
          body: await request.text(),
          signature: request.headers.get("x-pusher-signature"),
        })

        return new Response("ok")
      },
    })

    await once(hooks, "listening")
    seedPusher(emulator.store, {
      apps: [
        {
          ...APP,
          webhooks: [{ url: `http://127.0.0.1:${listeningPort(hooks)}/pusher` }],
        },
      ],
    })
    const connection = client()

    await connected(connection)
    await subscribed(connection, "news")
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0))
    hooks.close()

    const [first] = received

    expect(JSON.parse(first?.body ?? "{}")).toMatchObject({
      events: [{ name: "channel_occupied", channel: "news" }],
    })
    expect(first?.signature).toBe(
      createHmac("sha256", APP.secret)
        .update(first?.body ?? "")
        .digest("hex"),
    )
  })
})
