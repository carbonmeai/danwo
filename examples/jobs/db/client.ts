/**
 * The connection to Postgres the API and the worker each open: one pool, and a way to run a
 * transaction again when the database fails it for a moment (a serialization failure, a deadlock,
 * a dropped connection). The worker leans on Inngest for that instead: a step that throws is
 * retried, so its transactions run once per try.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"

import * as schema from "./schema.ts"

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
})

/*
 * A connection dropped by the server or a proxy is not the app's crash. Idle, the pool replaces
 * it; checked out, the client says so with an 'error' event, which would end the process unheard.
 * The statement in flight fails, and whoever ran it tries again.
 */
pool.on("error", (error) => console.warn(`postgres: idle connection lost (${describe(error)})`))
pool.on("connect", (client) =>
  client.on("error", (error) => console.warn(`postgres: connection lost (${describe(error)})`)),
)

export const db = drizzle(pool, { schema })

export type Database = NodePgDatabase<typeof schema>
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

/** A short description of an error, for the log. */
export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * SQLSTATEs a fresh attempt can get past: a serialization failure or deadlock, a server shutting
 * down, starting up or full, and lost connections.
 */
const RETRYABLE_STATES = new Set([
  "40001",
  "40P01",
  "57P01",
  "57P03",
  "53300",
  "08000",
  "08003",
  "08006",
])

/**
 * Words a driver error carries when the connection, not the statement, failed: among them the
 * ROLLBACK a transaction sends on a connection that has already dropped.
 */
const LOST_CONNECTION =
  /connection terminated|terminated unexpectedly|ECONNRESET|ECONNREFUSED|EPIPE|timeout|Connection ended|not queryable|Failed query: rollback/i

/** Whether a failed statement or transaction is worth running again. */
export function transient(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause)
    if (current instanceof pg.DatabaseError) return RETRYABLE_STATES.has(current.code ?? "")

  for (let current = error; current instanceof Error; current = current.cause)
    if (LOST_CONNECTION.test(current.message)) return true

  return false
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs `work` in one transaction, again from the start when the database fails it for a moment:
 * up to 7 tries, 100 ms apart and doubling to 1 s, long enough to ride out a few seconds' outage.
 * `work` must be safe to repeat: a COMMIT whose answer was lost may have committed.
 */
export async function transaction<T>(
  name: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work)
    } catch (error) {
      if (attempt >= 7 || !transient(error)) throw error

      console.warn(`postgres ${name}: attempt ${attempt} failed (${describe(error)}); retrying`)
      await sleep(Math.min(100 * 2 ** (attempt - 1), 1_000))
    }
  }
}

/** Closes the pool, for a clean shutdown. */
export function closeDatabase(): Promise<void> {
  return pool.end()
}
