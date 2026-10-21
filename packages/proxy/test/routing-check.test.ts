import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { createEmulator, stripe } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import type * as Preload from "../preload.mjs"
import { type Proxy, startProxy } from "../src/index.ts"
import { parseHeartbeat } from "../src/node-env.ts"

const run = promisify(execFile)
const AGENTS_APP = fileURLToPath(new URL("./fixtures/agents-app.ts", import.meta.url))
const OLD_NODE_APP = fileURLToPath(new URL("./fixtures/old-node-app.ts", import.meta.url))
const PROXY_DIR = fileURLToPath(new URL("..", import.meta.url))
const Out = z.record(z.string(), z.string())

/** The preload's helpers, without its side effects (`?inspect`). */
const preload: typeof Preload = await import(
  `${new URL("../preload.mjs", import.meta.url).href}?inspect`
)

const emulator = createEmulator(stripe)
let proxy: Proxy

beforeAll(async () => {
  proxy = await startProxy({
    routes: [
      {
        hosts: ["api.danwo.test", "api.stripe.com"],
        handler: async (request) => {
          const { pathname } = new URL(request.url)

          return pathname.startsWith("/v1/")
            ? emulator.fetch(request)
            : new Response(`routed ${pathname.slice(1)}`, { status: 200 })
        },
      },
    ],
    unmatched: "block",
  })
})

afterAll(async () => {
  await proxy.stop()
  await emulator.close()
})

/** Runs `node <args>` with `env`, never throwing: its output and exit code. */
async function node(args: readonly string[], env: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await run(process.execPath, [...args], {
      env,
      cwd: PROXY_DIR,
      timeout: 30_000,
    })

    return { stdout, stderr, code: 0 }
  } catch (error) {
    const failed = z
      .object({ stdout: z.string(), stderr: z.string(), code: z.number().nullable() })
      .parse(error)

    return { ...failed, code: failed.code ?? -1 }
  }
}

describe("which Nodes route through a proxy themselves", () => {
  it.each([
    ["20.19.5", false, false],
    ["22.18.0", false, false],
    ["22.21.0", true, true],
    ["23.11.1", false, false],
    ["24.0.0", true, false],
    ["24.4.1", true, false],
    ["24.5.0", true, true],
    ["25.1.0", true, true],
  ])("Node %s: fetch %s, agents %s", (version, fetch, agents) => {
    expect(preload.nativeProxySupport(version)).toEqual({ fetch, agents })
  })
})

describe("NO_PROXY, for the connections the preload tunnels itself", () => {
  it.each([
    ["localhost", 80, "localhost", true],
    ["api.localhost", 80, ".localhost", true],
    ["api.localhost", 80, "*.localhost", true],
    ["localhost", 3000, "127.0.0.1:4000,localhost:3000", true],
    ["localhost", 3001, "localhost:3000", false],
    ["::1", 8080, "[::1]:8080", true],
    ["[::1]", 8080, "[::1]", true],
    ["api.stripe.com", 443, "stripe.com", true],
    ["api.stripe.com", 443, "example.com, other.test", false],
    ["notstripe.com", 443, "stripe.com", false],
    ["api.stripe.com", 443, "*", true],
    ["api.stripe.com", 443, "", false],
  ])("%s:%s under %j bypasses: %s", (host, port, noProxy, bypassed) => {
    expect(preload.bypassesProxy(host, port, noProxy)).toBe(bypassed)
  })
})

describe("the start-up check", () => {
  it("names the calls that missed the proxy, and only those", () => {
    expect(
      preload.missedProbes({ fetch: true, "https.Agent": "ENOTFOUND", "http.Agent": true }),
    ).toEqual(["https.Agent (ENOTFOUND)"])
    expect(preload.missedProbes({ fetch: true, "https.Agent": true })).toEqual([])
  })

  it("says which Node runs the process and what to do about it", () => {
    const old = preload.unroutedMessage(41, "v22.18.0", ["fetch (ENOTFOUND)"])

    expect(old).toContain("process 41 runs Node v22.18.0")
    expect(old).toContain("fetch (ENOTFOUND) missed it")
    expect(old).toContain("Node 22.21 or later on the 22 line, or 24.5 or later")
    expect(preload.unroutedMessage(41, "v24.17.0", ["fetch (ENOTFOUND)"])).toContain("NO_PROXY")
  })

  it("reads the heartbeats the preload writes, and nothing else", () => {
    expect(
      parseHeartbeat(
        JSON.stringify({ routed: false, node: "v22.18.0", command: "server.js", missed: ["x"] }),
      ),
    ).toEqual({ routed: false, node: "v22.18.0", command: "server.js", missed: ["x"], fix: "" })
    expect(parseHeartbeat("server.js --port 3000")).toBeUndefined()
    expect(parseHeartbeat(JSON.stringify({ node: "v24.17.0" }))).toBeUndefined()
  })

  it("counts a process as preloaded once its calls reached the proxy", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      env: proxy.env(process.env, { nodeShim: false }),
      stdio: "ignore",
    })

    try {
      await expect.poll(() => proxy.preloaded(), { timeout: 5_000 }).toContain(child.pid)
      expect((await proxy.unrouted()).map((row) => row.pid)).not.toContain(child.pid)
    } finally {
      child.kill()
      await once(child, "exit")
    }
  })

  it("reports a process whose calls miss the proxy, naming its Node", async () => {
    const result = await node(["-e", "console.log('ran')"], {
      ...proxy.env(process.env, { nodeShim: false }),
      NO_PROXY: "*",
      no_proxy: "*",
    })

    expect(result.stdout).toBe("ran\n")
    expect(result.stderr).toContain(`runs Node ${process.version}`)
    expect(result.stderr).toContain("would reach the real providers")
    expect(await proxy.unrouted()).toContainEqual(
      expect.objectContaining({
        node: process.version,
        running: false,
        missed: expect.arrayContaining([expect.stringMatching(/^fetch /)]),
      }),
    )
  })

  it("stops a process that misses the proxy before its code runs, when the run requires it", async () => {
    const result = await node(["-e", "console.log('ran')"], {
      ...proxy.env(process.env, { nodeShim: false, requireProxy: true }),
      NO_PROXY: "*",
      no_proxy: "*",
    })

    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("danwo stops it")
  })
})

/** What an older Node sees: no NODE_USE_ENV_PROXY, so only the preload's own tunnels route. */
function tunnelled(): NodeJS.ProcessEnv {
  const env = proxy.env(process.env, { nodeShim: false })

  delete env.NODE_USE_ENV_PROXY

  return { ...env, DANWO_PRELOAD_TUNNEL: "1" }
}

describe("routing on a Node without proxy support", () => {
  it("tunnels fetch, the default agents and agents an app builds", async () => {
    const result = await node([OLD_NODE_APP], tunnelled())
    const out = Out.parse(JSON.parse(result.stdout))

    expect(out).toMatchObject({
      fetch: "200 routed fetch",
      https: "200 routed https",
      http: "200 routed http",
      agent: "200 routed agent",
    })
    expect(result.stderr).not.toContain("danwo:")
  })

  it("tunnels SDKs with their own transport: Stripe's agent, axios and undici", async () => {
    const result = await node([AGENTS_APP], tunnelled())
    const out = Out.parse(JSON.parse(result.stdout))

    expect(out.stripe).toMatch(/^cus_/)
    expect(out.axios).toBe("routed axios")
    expect(out.undici).toBe("routed undici")
  })

  it("leaves the hosts NO_PROXY names to go direct", async () => {
    const env = tunnelled()
    const result = await node([OLD_NODE_APP, "api.danwo.test", "http://127.0.0.1:9/"], {
      ...env,
      NO_PROXY: `${env.NO_PROXY},127.0.0.1:9`,
      no_proxy: `${env.NO_PROXY},127.0.0.1:9`,
    })

    /* Nothing listens on port 9: a direct call is refused, one through the proxy gets a 502. */
    expect(Out.parse(JSON.parse(result.stdout)).direct).toBe("error ECONNREFUSED")
  })
})
