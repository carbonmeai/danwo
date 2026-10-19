import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Exchange, Proxy } from "@danwo/proxy"
import { afterEach, describe, expect, it } from "vitest"

import { environmentRecord, writeEnvironmentRecord } from "../src/runner/environment-record.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"

function exchange(partial: Partial<Exchange> & Pick<Exchange, "host" | "path">): Exchange {
  return {
    disposition: "routed",
    method: "GET",
    startedAt: new Date(0).toISOString(),
    id: partial.path,
    client: "server",
    fault: null,
    status: 200,
    durationMs: 3,
    aborted: false,
    ...partial,
  }
}

/** An environment that started two apps, whose startup made three calls through the proxy. */
function started(): WorkerEnvironment {
  const exchanges = [
    exchange({ host: "api.clerk.com", path: "/v1/jwks?token=abc123" }),
    exchange({
      host: "js.stripe.com",
      path: "/v3",
      disposition: "blocked",
      status: 502,
      client: "browser",
    }),
    exchange({ host: "localhost", path: "/assets/app.js", asset: true }),
  ]
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the record reads only exchanges() and sockets() of the proxy
  const proxy = {
    exchanges: () => exchanges,
    sockets: () => [
      {
        id: "s1",
        disposition: "passthrough",
        host: "localhost",
        path: "/ws?session=s3cr3t",
        startedAt: new Date(0).toISOString(),
        client: "browser",
        fault: null,
      },
    ],
  } as unknown as Proxy

  return {
    proxy,
    notes: () => ["api: a Node process runs without danwo's preload"],
    logs: () => ({
      api: {
        lines: ["listening on 4400", "using key REDACTED-TEST-VALUE"],
        written: 2,
      },
      worker: { lines: ["ready"], written: 1 },
    }),
    async close() {},
  }
}

let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe("the environment record", () => {
  it("keeps the startup calls without query strings or page assets", () => {
    const record = environmentRecord(started(), 0)

    expect(record.calls).toEqual([
      {
        host: "api.clerk.com",
        method: "GET",
        path: "/v1/jwks",
        disposition: "routed",
        client: "server",
        status: 200,
      },
      {
        host: "js.stripe.com",
        method: "GET",
        path: "/v3",
        disposition: "blocked",
        client: "browser",
        status: 502,
      },
    ])
    expect(record.sockets).toEqual([
      { host: "localhost", path: "/ws", disposition: "passthrough", client: "browser" },
    ])
  })

  it("keeps each app's output, redacted, and danwo's notes", () => {
    const record = environmentRecord(started(), 1)

    expect(record.worker).toBe(1)
    expect(record.notes).toEqual(["api: a Node process runs without danwo's preload"])
    expect(record.logs.worker).toEqual(["ready"])
    expect(record.logs.api?.[0]).toBe("listening on 4400")
    expect(record.logs.api?.[1]).not.toContain("51NotARealKeyAtAll")
  })

  it("is written into the run's folder, made when no record made it yet", async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-env-record-"))
    const runDir = join(dir, "runs", "20261019-000000-abcd")

    await writeEnvironmentRecord(runDir, started(), 0)

    const written: unknown = JSON.parse(await readFile(join(runDir, "environment-0.json"), "utf8"))

    expect(written).toMatchObject({
      worker: 0,
      calls: [{ host: "api.clerk.com" }, { host: "js.stripe.com" }],
    })
  })

  it("never throws when the folder cannot be written", async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-env-record-"))
    await writeEnvironmentRecord(dir, started(), 0)

    /* A path under a file cannot be made into a folder. */
    await expect(
      writeEnvironmentRecord(join(dir, "environment-0.json", "run"), started(), 0),
    ).resolves.toBeUndefined()
  })
})
