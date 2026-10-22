/**
 * The app under test on a Node older than danwo's: monorepo packages pinned by volta, mise or
 * asdf, dev scripts that call a specific `node`, Docker images. Those Nodes ignore
 * NODE_USE_ENV_PROXY and `proxyEnv`, so the preload has to route them itself. Runs on every such
 * Node this machine has (nvm, volta, mise, asdf, Homebrew, or DANWO_OLD_NODES, a colon-separated
 * list of binaries), and skips when there is none.
 */
import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, readdirSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import { homedir, tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import type * as Preload from "../preload.mjs"
import { type Proxy, startProxy } from "../src/index.ts"

const run = promisify(execFile)
const APP_SOURCE = fileURLToPath(new URL("./fixtures/old-node-app.ts", import.meta.url))
const Out = z.record(z.string(), z.string())

const preload: typeof Preload = await import(
  `${new URL("../preload.mjs", import.meta.url).href}?inspect`
)

/** `<dir>/<version>/<bin>` for every version folder in `dir`. */
function installs(dir: string, bin: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir).map((version) => join(dir, version, bin))
}

/** Node binaries on this machine that do not proxy by themselves, one per version. */
async function olderNodes(): Promise<readonly { version: string; bin: string }[]> {
  const home = homedir()
  const candidates = [
    ...(process.env.DANWO_OLD_NODES ?? "").split(delimiter).filter(Boolean),
    ...installs(join(home, ".nvm/versions/node"), "bin/node"),
    ...installs(join(home, ".volta/tools/image/node"), "bin/node"),
    ...installs(join(home, ".local/share/mise/installs/node"), "bin/node"),
    ...installs(join(home, ".asdf/installs/nodejs"), "bin/node"),
    "/opt/homebrew/opt/node@22/bin/node",
    "/opt/homebrew/opt/node@20/bin/node",
    "/usr/local/opt/node@22/bin/node",
    "/usr/local/opt/node@20/bin/node",
  ]
  const found = new Map<string, string>()

  for (const bin of candidates.filter((path) => existsSync(path))) {
    const version = await run(bin, ["-p", "process.versions.node"], { timeout: 10_000 }).then(
      ({ stdout }) => stdout.trim(),
      () => undefined,
    )
    const major = Number(version?.split(".")[0])

    if (version === undefined || major < 20) continue
    if (preload.nativeProxySupport(version).agents) continue
    found.set(version, bin)
  }

  return [...found].map(([version, bin]) => ({ version, bin }))
}

const nodes = await olderNodes()
let proxy: Proxy
let dir: string
let app: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-old-node-"))
  app = join(dir, "app.mjs")
  await writeFile(app, stripTypeScriptTypes(await readFile(APP_SOURCE, "utf8")))
  proxy = await startProxy({
    routes: [
      {
        hosts: ["api.danwo.test"],
        handler: async (request) =>
          new Response(`routed ${new URL(request.url).pathname.slice(1)}`),
      },
    ],
    unmatched: "block",
  })
})

afterAll(async () => {
  await proxy.stop()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The app's output on `bin` with `env`. */
async function calls(bin: string, env: NodeJS.ProcessEnv) {
  const { stdout, stderr } = await run(bin, [app], { env, cwd: dir, timeout: 60_000 })

  return { out: Out.parse(JSON.parse(stdout)), stderr }
}

describe.skipIf(nodes.length === 0)("an app on an older Node", () => {
  it.each(nodes)(
    "Node $version ignores NODE_USE_ENV_PROXY on its own",
    async ({ bin, version }) => {
      const env = proxy.env(process.env, { nodeShim: false })

      delete env.NODE_OPTIONS
      const { out } = await calls(bin, env)

      /* Straight to DNS, which knows no api.danwo.test: the call never saw the proxy. */
      expect(out.agent).toMatch(/^error /)
      expect(out.https).toMatch(/^error /)
      /* 24.0 to 24.4 proxy fetch by themselves, and only fetch. */
      expect(out.fetch).toMatch(preload.nativeProxySupport(version).fetch ? /^200 / : /^error /)
    },
  )

  it.each(nodes)("Node $version goes through the proxy with the preload", async ({ bin }) => {
    const { out, stderr } = await calls(bin, proxy.env(process.env, { nodeShim: false }))

    expect(out).toMatchObject({
      fetch: "200 routed fetch",
      https: "200 routed https",
      http: "200 routed http",
      agent: "200 routed agent",
    })
    expect(stderr).not.toContain("danwo:")
  })

  it.each(nodes)("Node $version counts as routed in its heartbeat", async ({ bin }) => {
    const child = spawn(bin, ["-e", "setTimeout(() => {}, 10000)"], {
      env: proxy.env(process.env, { nodeShim: false }),
      stdio: "ignore",
    })

    try {
      await expect.poll(() => proxy.preloaded(), { timeout: 10_000 }).toContain(child.pid)
    } finally {
      child.kill()
      await once(child, "exit")
    }
  })

  it.each(nodes)("Node $version that misses the proxy stops at start", async ({ bin, version }) => {
    const env = { ...proxy.env(process.env, { nodeShim: false, requireProxy: true }) }
    const result = await run(bin, ["-e", "console.log('ran')"], {
      env: { ...env, NO_PROXY: "*", no_proxy: "*" },
      timeout: 30_000,
    }).then(
      () => ({ code: 0, stdout: "ran", stderr: "" }),
      (error: unknown) =>
        z.object({ code: z.number(), stdout: z.string(), stderr: z.string() }).parse(error),
    )

    expect(result.code).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`runs Node v${version}`)
    expect(await proxy.unrouted()).toContainEqual(
      expect.objectContaining({ node: `v${version}`, running: false }),
    )
  })
})
