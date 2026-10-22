import { DatabaseError, Pool, type QueryResultRow } from "pg"

import { withRetry } from "./retry.ts"

/** The table the waitlist keeps; the test environment creates it in each worker's database. */
export const SCHEMA = `
  create table if not exists signups (
    id bigint generated always as identity primary key,
    email text not null unique,
    created_at timestamptz not null default now(),
    welcomed_at timestamptz
  )
`

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 2_000,
})

/* An idle connection that drops is replaced on the next query; it must not crash the server. */
pool.on("error", () => undefined)

/**
 * Postgres errors worth another try: a lost connection, a server that is starting, full or
 * shutting down, and a transaction that lost a race. A constraint or syntax error is final.
 */
function transient(error: unknown): boolean {
  if (!(error instanceof DatabaseError)) return true

  const code = error.code ?? ""

  return code.startsWith("08") || ["40001", "40P01", "53300", "57P01", "57P03"].includes(code)
}

/** Runs one statement and returns its rows, retrying transient failures. */
export async function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  return withRetry(async () => (await pool.query<Row>(text, [...values])).rows, transient)
}

/** Closes the pool, when the server stops. */
export function closeDatabase(): Promise<void> {
  return pool.end()
}
