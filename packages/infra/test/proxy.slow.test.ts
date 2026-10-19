import { Redis } from "ioredis"
import { Client } from "pg"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { container, dockerAvailable, startPostgres, waitFor } from "../../data/test/containers.ts"
import { pgError, redisError, startPostgresProxy, startRedisProxy } from "../src/index.ts"
import type { DataProxy } from "../src/types.ts"

/** The SQLSTATE or message a failed call rejected with. */
async function failure(call: Promise<unknown>): Promise<string> {
  try {
    await call
  } catch (error) {
    if (!(error instanceof Error)) return String(error)

    return "code" in error && typeof error.code === "string" ? error.code : error.message
  }

  throw new Error("expected the call to fail")
}

describe.skipIf(!dockerAvailable())("the Postgres fault proxy, against Postgres 17", () => {
  let server: Awaited<ReturnType<typeof startPostgres>>
  let proxy: DataProxy
  let direct: Client

  /** A client connected through the proxy, as the app's would be. */
  async function app(): Promise<Client> {
    const client = new Client({ connectionString: proxy.url(server.url) })

    client.on("error", () => undefined)
    await client.connect()

    return client
  }

  const balance = async () =>
    Number((await direct.query("SELECT balance FROM accounts WHERE id = 1")).rows[0]?.balance)

  beforeAll(async () => {
    server = await startPostgres()
    proxy = await startPostgresProxy({ upstream: server.url })
    direct = new Client({ connectionString: server.url })
    await direct.connect()
    await direct.query("CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL)")
  }, 180_000)

  beforeEach(async () => {
    proxy.clear()
    proxy.dropConnections()
    await direct.query("TRUNCATE accounts")
    await direct.query("INSERT INTO accounts VALUES (1, 100)")
  })

  afterAll(async () => {
    await direct?.end()
    await proxy?.close()
    server?.stop()
  })

  it("records a transaction's statements, through TLS negotiation and the extended protocol", async () => {
    const client = await app()

    await client.query("BEGIN")
    await client.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [10, 1])
    await client.query("SELECT balance FROM accounts WHERE id = $1", [1])
    await client.query("COMMIT")
    await client.end()

    expect(await balance()).toBe(90)
    expect(
      proxy
        .calls()
        .filter((call) => call.role !== "other")
        .map((call) => [call.operation, call.outcome]),
    ).toEqual([
      ["BEGIN", "ok"],
      ["UPDATE accounts", "ok"],
      ["SELECT accounts", "ok"],
      ["COMMIT", "ok"],
    ])
  })

  it("injects serialization_failure on an UPDATE; the transaction is failed, then rolls back", async () => {
    const client = await app()

    proxy.setFault((call) =>
      call.verb === "UPDATE" ? pgError("serialization_failure") : undefined,
    )
    await client.query("BEGIN")
    expect(await failure(client.query("UPDATE accounts SET balance = 0 WHERE id = 1"))).toBe(
      "40001",
    )
    expect(await failure(client.query("SELECT 1"))).toBe("25P02")
    await client.query("ROLLBACK")
    expect((await client.query("SELECT 2 AS two")).rows[0]?.two).toBe(2)
    await client.end()

    expect(await balance()).toBe(100)
  })

  it("injects serialization_failure on COMMIT: nothing is committed, the connection lives on", async () => {
    const client = await app()

    proxy.setFault((call) =>
      call.verb === "COMMIT" ? pgError("serialization_failure") : undefined,
    )
    await client.query("BEGIN")
    await client.query("UPDATE accounts SET balance = 0 WHERE id = 1")
    expect(await failure(client.query("COMMIT"))).toBe("40001")
    proxy.setFault()
    expect((await client.query("SELECT 1 AS one")).rows[0]?.one).toBe(1)
    await client.end()

    expect(await balance()).toBe(100)
  })

  it("commits, then drops the reply (reset-after on COMMIT): committed, but the app never knew", async () => {
    const client = await app()

    proxy.setFault((call) => (call.verb === "COMMIT" ? { kind: "reset-after" } : undefined))
    await client.query("BEGIN")
    await client.query("UPDATE accounts SET balance = 0 WHERE id = 1")
    expect(await failure(client.query("COMMIT"))).toMatch(/terminated|ECONNRESET|closed/i)

    expect(await balance()).toBe(0)
    expect(proxy.calls().find((call) => call.verb === "COMMIT")).toMatchObject({
      outcome: "reset",
      fault: "reset-after on COMMIT (postgres)",
    })
  })

  it("drops the line before a write reaches the server (reset)", async () => {
    const client = await app()

    proxy.setFault((call) => (call.verb === "UPDATE" ? { kind: "reset" } : undefined))
    expect(await failure(client.query("UPDATE accounts SET balance = 0 WHERE id = 1"))).toMatch(
      /terminated|ECONNRESET|closed/i,
    )
    expect(await balance()).toBe(100)
  })

  it("slows a write down (delay)", async () => {
    const client = await app()

    proxy.setFault((call) => (call.verb === "UPDATE" ? { kind: "delay", ms: 300 } : undefined))

    const started = Date.now()

    await client.query("UPDATE accounts SET balance = 1 WHERE id = 1")
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    await client.end()
  })

  it("takes the database down for a while, then turns connections away as full", async () => {
    const client = await app()

    proxy.setFault((call) => (call.verb === "BEGIN" ? { kind: "down", ms: 600 } : undefined))
    await failure(client.query("BEGIN"))
    expect(await failure(app())).toMatch(/terminated|ECONNRESET|closed|connect/i)
    await new Promise((resolve) => setTimeout(resolve, 700))
    await (await app()).end()

    const second = await app()

    proxy.setFault((call) =>
      call.verb === "BEGIN" ? { kind: "down", ms: 600, refuse: "too-many-connections" } : undefined,
    )
    await failure(second.query("BEGIN"))
    expect(await failure(app())).toBe("53300")

    // Turning faults off ends the outage at once, as the matrix does between trials.
    proxy.setFault()
    await (await app()).end()
  })
})

describe.skipIf(!dockerAvailable())("the Redis fault proxy, against Redis 7", () => {
  let server: Awaited<ReturnType<typeof container>>
  let proxy: DataProxy
  let direct: Redis

  /** A client through the proxy that neither retries nor resends, to see each fault as it lands. */
  function app(): Redis {
    return new Redis(proxy.url(`redis://127.0.0.1:${server.port}/0`), {
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      retryStrategy: () => null,
      lazyConnect: true,
    })
  }

  beforeAll(async () => {
    server = await container("redis:7-alpine", 6379)
    await waitFor(async () => {
      const probe = new Redis({
        port: server.port,
        host: "127.0.0.1",
        lazyConnect: true,
        retryStrategy: () => null,
      })

      probe.on("error", () => undefined)

      try {
        await probe.connect()
        await probe.ping()
      } finally {
        probe.disconnect()
      }
    }, "redis")
    direct = new Redis({ port: server.port, host: "127.0.0.1" })
    proxy = await startRedisProxy({ upstream: `redis://127.0.0.1:${server.port}` })
  }, 180_000)

  afterEach(async () => {
    proxy.clear()
    proxy.dropConnections()
    await direct.flushdb()
  })

  afterAll(async () => {
    direct?.disconnect()
    await proxy?.close()
    server?.stop()
  })

  it("records commands with their keys folded, MULTI/EXEC included", async () => {
    const client = app()

    await client.connect()
    await client.multi().incr("rate:203.0.113.9").expire("rate:203.0.113.9", 60).exec()
    await client.get("session:6f1c2a9e-1b2c-4d5e-8f90-123456789abc")
    client.disconnect()

    expect(
      proxy
        .calls()
        .filter((call) => call.role !== "other")
        .map((call) => [call.operation, call.inTransaction, call.outcome]),
    ).toEqual([
      ["INCR rate:*", true, "ok"],
      ["EXPIRE rate:*", true, "ok"],
      ["EXEC", true, "ok"],
      ["GET session:*", false, "ok"],
    ])
  })

  it("answers OOM, LOADING and READONLY in the server's place", async () => {
    const client = app()

    await client.connect()
    proxy.setFault((call) =>
      call.verb === "SET"
        ? redisError("OOM")
        : call.verb === "GET"
          ? redisError("LOADING")
          : call.verb === "DEL"
            ? redisError("READONLY")
            : undefined,
    )
    expect(await failure(client.set("a", "1"))).toMatch(/^OOM /)
    expect(await failure(client.get("a"))).toMatch(/^LOADING /)
    expect(await failure(client.del("a"))).toMatch(/^READONLY /)
    proxy.setFault()
    expect(await client.incr("n")).toBe(1)
    client.disconnect()

    expect(await direct.exists("a")).toBe(0)
  })

  it("runs an INCR then drops the reply (reset-after): counted, but the app never knew", async () => {
    const client = app()

    client.on("error", () => undefined)
    await client.connect()
    proxy.setFault((call) => (call.verb === "INCR" ? { kind: "reset-after" } : undefined))
    expect(await failure(client.incr("rate:7"))).toMatch(/closed|reset|ECONNRESET/i)
    expect(await direct.get("rate:7")).toBe("1")
  })

  it("times a command out (delay past the client's timeout)", async () => {
    const client = new Redis(proxy.url(`redis://127.0.0.1:${server.port}/0`), {
      commandTimeout: 100,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    })

    await client.connect()
    proxy.setFault((call) => (call.verb === "GET" ? { kind: "delay", ms: 400 } : undefined))
    expect(await failure(client.get("a"))).toMatch(/timed out/i)
    client.disconnect()
  })
})
