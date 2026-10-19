import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { createEmulator, stripe } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { type Proxy, startProxy } from "../src/index.ts"

const run = promisify(execFile)
const APP = fileURLToPath(new URL("./fixtures/agents-app.ts", import.meta.url))
const Out = z.record(z.string(), z.string())

const emulator = createEmulator(stripe)
let proxy: Proxy

beforeAll(async () => {
  proxy = await startProxy({
    routes: [
      {
        /* Stripe's SDK is pointed here by `host`; other paths answer with their own name. */
        hosts: ["api.danwo.test", "api.stripe.com"],
        handler: async (request) => {
          const { pathname } = new URL(request.url)

          return pathname.startsWith("/v1/")
            ? emulator.fetch(request)
            : new Response(pathname.slice(1), { status: 200 })
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

/** Runs the app the way a package script would: `NODE_OPTIONS=… node app`, replacing danwo's. */
async function runScript(env: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  const { stdout } = await run(
    "/bin/sh",
    ["-c", `NODE_OPTIONS=--max-old-space-size=256 node "${APP}"`],
    {
      env,
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      timeout: 30_000,
    },
  )

  return Out.parse(JSON.parse(stdout))
}

describe("SDKs with their own transport", () => {
  it("routes Stripe's own https.Agent, axios with a custom agent and undici's Agent", async () => {
    const { stdout } = await run(process.execPath, [APP], {
      env: proxy.env(),
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      timeout: 30_000,
    })
    const out = Out.parse(JSON.parse(stdout))

    expect(out.stripe).toMatch(/^cus_/)
    expect(out.axios).toBe("axios")
    expect(out.undici).toBe("undici")
  })

  it("keeps the preload when a start script replaces NODE_OPTIONS, through the node shim", async () => {
    const out = await runScript(proxy.env())

    expect(out).toMatchObject({ axios: "axios", undici: "undici" })
    expect(out.stripe).toMatch(/^cus_/)
  })

  it("loses the agents without the shim, which is what the heartbeat is there to catch", async () => {
    const out = await runScript(proxy.env(process.env, { nodeShim: false }))

    expect(out.axios).toMatch(/^error /)
    expect(out.undici).toMatch(/^error /)
  })
})

describe("the preload heartbeat", () => {
  it("lists the processes that loaded the preload while they run", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      env: proxy.env(),
      stdio: "ignore",
    })

    try {
      await expect.poll(() => proxy.preloaded(), { timeout: 5_000 }).toContain(child.pid)
    } finally {
      child.kill()
      await once(child, "exit")
    }

    await expect.poll(() => proxy.preloaded()).not.toContain(child.pid)
  })
})
