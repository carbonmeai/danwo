/**
 * Relay's connection to Postgres: one pool, and helpers that retry what a database can fail
 * at for a moment (a serialization failure, a deadlock, a dropped connection), each in a
 * transaction so a retry starts from a clean slate.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"

import { describe, retrying } from "../retry.ts"
import * as schema from "./schema.ts"

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
})

/*
 * A connection the server or a proxy drops is not the app's crash. Idle, the pool replaces it;
 * checked out, between two statements of a transaction, the client says so with an 'error'
 * event, which would end the process unheard. The statement in flight fails and is retried.
 */
pool.on("error", (error) => console.warn(`postgres: idle connection lost (${describe(error)})`))
pool.on("connect", (client) =>
  client.on("error", (error) => console.warn(`postgres: connection lost (${describe(error)})`)),
)

export const db = drizzle(pool, { schema })

export type Database = NodePgDatabase<typeof schema>
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

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
 * Words a driver error carries when the connection, not the statement, failed. A ROLLBACK that
 * fails is one too: the connection dropped mid-transaction, so nothing was committed.
 */
const LOST_CONNECTION =
  /connection terminated|terminated unexpectedly|ECONNRESET|ECONNREFUSED|EPIPE|timeout|Connection ended|not queryable|Client was closed|^Failed query: rollback/i

/** The SQLSTATE of a Postgres error, through drizzle's wrapper when there is one. */
function stateOf(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause)
    if (current instanceof pg.DatabaseError) return current.code

  return undefined
}

/** Whether a failed statement or transaction is worth running again. */
export function transient(error: unknown): boolean {
  const state = stateOf(error)

  if (state !== undefined) return RETRYABLE_STATES.has(state)

  for (let current = error; current instanceof Error; current = current.cause)
    if (LOST_CONNECTION.test(current.message)) return true

  return false
}

/** Up to 7 attempts, 100 ms apart and doubling to 1 s: long enough to ride out a few seconds' outage. */
function policy(name: string) {
  return {
    name: `postgres ${name}`,
    attempts: 7,
    retryable: transient,
    delayMs: (attempt: number) => Math.min(100 * 2 ** (attempt - 1), 1_000),
  }
}

/**
 * Runs `work` in one transaction, again from the start when the database fails
 * it for a moment. `work` must be safe to repeat: a COMMIT whose answer was lost may have
 * committed, so the retry has to recognise its own earlier writes.
 */
export function transaction<T>(name: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return retrying(policy(name), () => db.transaction(work))
}

/** Runs one read or single-statement write, retried the same way. */
export function query<T>(name: string, work: (database: Database) => Promise<T>): Promise<T> {
  return retrying(policy(name), () => work(db))
}

/** Closes the pool, for a clean shutdown. */
export function closeDatabase(): Promise<void> {
  return pool.end()
}
