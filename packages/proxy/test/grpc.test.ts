/**
 * Real gRPC through the proxy: a grpc-js client run with nothing but `proxy.env()`, as an app
 * runs, calling a route's handler, and a real grpc-js server over TLS and in plaintext. Unary,
 * server-streaming and two-way calls, and a failed call's status, all come back as sent.
 */
import { execFile } from "node:child_process"
import { once } from "node:events"
import { connect, createServer as createNetServer, type Server as NetServer } from "node:net"
import { TLSSocket } from "node:tls"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { listeningPort } from "@danwo/emulators"
import { Server, ServerCredentials } from "@grpc/grpc-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAuthority } from "../src/authority.ts"
import { type Handler, type Proxy, startProxy } from "../src/proxy.ts"
import { decodeText, encodeText, GREETER, greeterHandlers, methodPath } from "./fixtures/greeter.ts"

const run = promisify(execFile)
const CLIENT = fileURLToPath(new URL("./fixtures/grpc-client.ts", import.meta.url))

/** The host the route answers, as an emulator would answer a provider's gRPC API. */
const ROUTED = "greeter.danwo.test"

/** gRPC's length-prefixed messages in a body. */
function messagesOf(body: Buffer): Buffer[] {
  const out: Buffer[] = []

  for (let at = 0; at + 5 <= body.length;) {
    const length = body.readUInt32BE(at + 1)

    out.push(body.subarray(at + 5, at + 5 + length))
    at += 5 + length
  }

  return out
}

function framed(texts: readonly string[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    Buffer.concat(
      texts.map((text) => {
        const message = encodeText(text)
        const prefix = Buffer.alloc(5)

        prefix.writeUInt32BE(message.length, 1)

        return Buffer.concat([prefix, message])
      }),
    ),
  )
}

/** A handler that answers the greeter's calls whole, as an emulator does. */
const emulated: Handler = async (request) => {
  const [first] = messagesOf(Buffer.from(await request.arrayBuffer()))
  const name = decodeText(first ?? Buffer.alloc(0))
  const path = new URL(request.url).pathname
  const grpc = { "content-type": "application/grpc" }

  if (name === "missing")
    return new Response(null, {
      headers: { ...grpc, "grpc-status": "5", "grpc-message": "no such name" },
    })

  const texts =
    path === methodPath("CountUp") ? [1, 2, 3].map((n) => `${name} ${n}`) : [`hello ${name}`]

  return new Response(framed(texts), { headers: { ...grpc, "grpc-status": "0" } })
}

let proxy: Proxy
let server: Server
let plainPort: number
let tlsFront: NetServer

beforeAll(async () => {
  proxy = await startProxy({ routes: [{ hosts: [ROUTED], handler: emulated }] })
  server = new Server()
  server.addService(GREETER, greeterHandlers)
  plainPort = await new Promise<number>((resolve, reject) =>
    server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (error, port) =>
      error ? reject(error) : resolve(port),
    ),
  )

  /* The same server over TLS, as a gRPC server with a development certificate serves it. */
  const context = await (await createAuthority("a local dev CA")).contextFor("localhost")

  tlsFront = createNetServer((raw) => {
    const tls = new TLSSocket(raw, {
      isServer: true,
      secureContext: context,
      ALPNProtocols: ["h2"],
    })

    tls.on("error", () => {})
    tls.once("secure", () => {
      const backend = connect(plainPort, "127.0.0.1")

      backend.on("error", () => tls.destroy())
      tls.pipe(backend).pipe(tls)
    })
  })
  tlsFront.listen(0, "127.0.0.1")
  await once(tlsFront, "listening")
})

afterAll(async () => {
  tlsFront.close()
  server.forceShutdown()
  await proxy.stop()
})

/** What the client got, run with the proxy's environment and no other. */
async function client(target: string, security: "tls" | "plain", calls?: string) {
  const env = proxy.env({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" })
  const { stdout } = await run(
    process.execPath,
    [CLIENT, target, security, ...(calls === undefined ? [] : [calls])],
    { env, timeout: 20_000 },
  )

  return JSON.parse(stdout) as unknown
}

const ALL = {
  unary: "hello ada",
  stream: ["count 1", "count 2", "count 3"],
  chat: ["echo one", "echo two"],
  failed: "error 5 no such name",
}

describe("gRPC through the proxy", () => {
  it("is answered by a route's handler over TLS, trusting danwo's CA from the environment", async () => {
    expect(await client(`${ROUTED}:443`, "tls", "unary,stream,failed")).toEqual({
      unary: "hello ada",
      stream: ["count 1", "count 2", "count 3"],
      failed: "error 5 no such name",
    })
    await proxy.settled()

    const calls = proxy.exchanges().filter((e) => e.host === ROUTED)

    expect(calls.map((e) => [e.method, e.path, e.status, e.disposition])).toEqual([
      ["POST", methodPath("SayHello"), 200, "routed"],
      ["POST", methodPath("CountUp"), 200, "routed"],
      ["POST", methodPath("SayHello"), 200, "routed"],
    ])
  })

  it("fails one call with a reset fault, and the next call on the same channel goes through", async () => {
    proxy.failNext((call) => call.path === methodPath("SayHello"), { kind: "reset" })

    const got = await client(`${ROUTED}:443`, "tls", "unary,stream")

    expect(got).toMatchObject({ stream: ["count 1", "count 2", "count 3"] })
    expect(got).toHaveProperty("unary", expect.stringMatching(/^error 13 .*RST_STREAM with code 2/))
  })

  it("passes calls on to a real gRPC server over TLS, streams and failures included", async () => {
    expect(await client(`localhost:${listeningPort(tlsFront)}`, "tls")).toEqual(ALL)
    await proxy.settled()
    expect(
      proxy
        .exchanges()
        .filter((e) => e.host === "localhost")
        .map((e) => [e.path, e.disposition, e.stream]),
    ).toContainEqual([methodPath("CountUp"), "passthrough", true])
  })

  it("passes calls on to a real gRPC server in plaintext", async () => {
    expect(await client(`127.0.0.1:${plainPort}`, "plain")).toEqual(ALL)
    await proxy.settled()
    expect(
      proxy.exchanges().some((e) => e.host === "127.0.0.1" && e.path === methodPath("Chat")),
    ).toBe(true)
  })
})
