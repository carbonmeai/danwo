import { DatabaseError, Pool, type QueryResultRow } from "pg"

import { broken } from "./bugs.ts"
import { withRetry } from "./retry.ts"

/**
 * The app's own tables, which the test environment creates in each worker's database: one row per
 * Clerk user, and one per organization membership, both written from Clerk's webhooks. Each row
 * keeps the Clerk `updated_at` it was written from, so a late webhook never rolls it back.
 */
export function schema(): string[] {
  /* With `no-upsert`, nothing in the database stops a second row for the same Clerk user. */
  const once = broken("no-upsert") ? "" : "unique"

  return [
    `create table if not exists app_users (
       id bigint generated always as identity primary key,
       clerk_user_id text not null ${once},
       email text not null,
       first_name text,
       last_name text,
       clerk_updated_at bigint not null,
       created_at timestamptz not null default now()
     )`,
    `create table if not exists memberships (
       id bigint generated always as identity primary key,
       clerk_membership_id text not null unique,
       clerk_org_id text not null,
       org_name text not null,
       clerk_user_id text not null,
       role text not null,
       clerk_updated_at bigint not null,
       unique (clerk_org_id, clerk_user_id)
     )`,
  ]
}

/** One pool for the server, kept across Next.js's module reloads in development. */
const shared = globalThis as typeof globalThis & { lumenPool?: Pool }

function pool(): Pool {
  if (shared.lumenPool === undefined) {
    const created = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2_000,
    })

    /* An idle connection that drops is replaced on the next query; it must not crash the server. */
    created.on("error", () => undefined)
    shared.lumenPool = created
  }

  return shared.lumenPool
}

/**
 * Postgres errors worth another try: a lost connection, a server that is starting, full or
 * shutting down, and a transaction that lost a race. A constraint or syntax error is final.
 */
function transient(error: unknown): boolean {
  if (!(error instanceof DatabaseError)) return true

  const code = error.code ?? ""

  return code.startsWith("08") || ["40001", "40P01", "53300", "57P01", "57P03"].includes(code)
}

/**
 * Runs one statement and returns its rows, retrying transient failures. Only pass statements
 * that are safe to run twice: a retry after a lost answer runs it again.
 */
export async function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  return withRetry(async () => (await pool().query<Row>(text, [...values])).rows, transient)
}
