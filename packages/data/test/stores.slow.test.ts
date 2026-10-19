import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { rebuild, withDatabase } from "../../cli/test/fixtures/orders-postgres/schema.ts"
import { postgresSnapshot, postgresWorkerDatabase } from "../src/postgres.ts"
import { redisSnapshot } from "../src/redis.ts"
import { RespClient } from "../src/resp.ts"
import { container, dockerAvailable, startPostgres, waitFor } from "./containers.ts"

const Count = z.object({ n: z.number() })

async function countOrders(pool: Pool): Promise<number> {
  const result = await pool.query("SELECT count(*)::int AS n FROM orders")

  return Count.parse(result.rows[0]).n
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

describe.skipIf(!dockerAvailable())("Postgres snapshots", () => {
  let server: Awaited<ReturnType<typeof startPostgres>>
  let url: string

  beforeAll(async () => {
    server = await startPostgres()
    url = server.url
    await rebuild(url, "orders_base")
  }, 180_000)

  afterAll(() => server.stop())

  for (const strategy of ["recreate", "swap"] as const) {
    it(`restores with ${strategy} while the app's pool stays open, and times it against a rebuild`, async () => {
      const appUrl = await postgresWorkerDatabase(withDatabase(url, "orders_base"), 9)
      const app = new Pool({ connectionString: appUrl, max: 2 })

      app.on("error", () => {})

      const db = postgresSnapshot({ url: appUrl, strategy })
      const restores: number[] = []

      try {
        await db.snapshot()

        for (let trial = 0; trial < 5; trial++) {
          // A trial: the app writes for a while, as a test body would.
          await app.query("INSERT INTO orders (payment_intent) VALUES ('pi_x'), ('pi_y')")
          await new Promise((resolve) => setTimeout(resolve, 500))
          expect(await countOrders(app)).toBe(2)

          const started = performance.now()

          await db.restore()
          restores.push(performance.now() - started)
          expect(await countOrders(app)).toBe(0)
        }
      } finally {
        await app.end()
        await db.close()
      }

      const rebuilt = performance.now()

      await rebuild(url, "orders_rebuilt")

      const rebuildMs = performance.now() - rebuilt

      console.log(
        `${strategy}: restore median ${median(restores).toFixed(0)} ms; rebuild ${rebuildMs.toFixed(0)} ms`,
      )
      /* Timings are reported, not asserted: under a loaded machine they vary too much to gate on. */
      expect(restores.every((ms) => Number.isFinite(ms))).toBe(true)
    }, 120_000)
  }

  it("restores rows without closing the app's connections, foreign keys and sequences included", async () => {
    const appUrl = await postgresWorkerDatabase(withDatabase(url, "orders_base"), 8)
    const app = new Pool({ connectionString: appUrl, max: 1 })
    /* A pool with no error listener: a closed connection would crash a process that has none. */
    const errors: unknown[] = []

    app.on("error", (error) => errors.push(error))
    await app.query(
      "CREATE TABLE customers (id serial PRIMARY KEY, name text, upper_name text GENERATED ALWAYS AS (upper(name)) STORED)",
    )
    await app.query(
      "CREATE TABLE invoices (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, customer int REFERENCES customers(id))",
    )
    await app.query("INSERT INTO customers (name) VALUES ('ada')")
    await app.query("INSERT INTO invoices (customer) VALUES (1)")

    const held = await app.connect()
    const db = postgresSnapshot({ url: appUrl, strategy: "rows" })

    try {
      await db.snapshot()
      await held.query("INSERT INTO customers (name) VALUES ('grace'), ('alan')")
      await held.query("INSERT INTO invoices (customer) VALUES (2), (3)")
      await held.query("DELETE FROM invoices WHERE id = 1")

      await db.restore()

      const customers = await held.query("SELECT id, name, upper_name FROM customers ORDER BY id")
      const invoices = await held.query("SELECT id, customer FROM invoices ORDER BY id")

      expect(customers.rows).toEqual([{ id: 1, name: "ada", upper_name: "ADA" }])
      expect(invoices.rows).toEqual([{ id: "1", customer: 1 }])

      /* The sequences are back too: the next rows get the ids they got after the snapshot. */
      const next = await held.query("INSERT INTO customers (name) VALUES ('grace') RETURNING id")

      expect(next.rows).toEqual([{ id: 2 }])
      expect(errors).toEqual([])
    } finally {
      held.release()
      await app.end()
      await db.close()
    }
  }, 60_000)

  it("gives parallel workers their own databases", async () => {
    const base = withDatabase(url, "orders_base")
    const urls = await Promise.all([0, 1, 2].map((index) => postgresWorkerDatabase(base, index)))

    expect(urls.map((each) => new URL(each).pathname)).toEqual([
      "/orders_base_w0",
      "/orders_base_w1",
      "/orders_base_w2",
    ])

    const pools = urls.map((each) => new Pool({ connectionString: each, max: 1 }))

    try {
      await pools[0]?.query("INSERT INTO orders (payment_intent) VALUES ('pi_w0')")

      const counts = await Promise.all(pools.map((pool) => countOrders(pool)))

      expect(counts).toEqual([1, 0, 0])
    } finally {
      await Promise.all(pools.map((pool) => pool.end()))
    }
  }, 60_000)
})

describe.skipIf(!dockerAvailable())("Redis snapshots", () => {
  it("brings back keys, values and expiries, and drops keys added later", async () => {
    const server = await container("redis:7-alpine", 6379)
    const url = `redis://127.0.0.1:${server.port}/3`

    try {
      await waitFor(async () => {
        const probe = await RespClient.open(url)

        try {
          await probe.call("PING")
        } finally {
          probe.close()
        }
      }, "redis")

      const app = await RespClient.open(url)
      const cache = redisSnapshot({ url })

      try {
        await app.call("SELECT", "3")
        await app.call("SET", "session:ada", "signed-in", "PX", "600000")
        await app.call("RPUSH", "queue", "a", "b")
        await app.call("SET", "bytes", Buffer.from([0, 255, 13, 10]))
        await cache.snapshot()

        await app.call("SET", "session:ada", "changed")
        await app.call("SET", "later", "1")
        await app.call("DEL", "queue")
        await cache.restore()

        expect(String(await app.call("GET", "session:ada"))).toBe("signed-in")
        expect(Number(await app.call("PTTL", "session:ada"))).toBeGreaterThan(0)
        expect(await app.call("GET", "later")).toBeNull()
        expect(await app.call("LRANGE", "queue", "0", "-1")).toEqual([
          Buffer.from("a"),
          Buffer.from("b"),
        ])
        expect(await app.call("GET", "bytes")).toEqual(Buffer.from([0, 255, 13, 10]))
      } finally {
        app.close()
        await cache.close()
      }
    } finally {
      server.stop()
    }
  }, 120_000)
})
