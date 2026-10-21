import { DatabaseError, Pool, type PoolClient, type QueryResultRow } from "pg"

import { withRetry } from "./retry.ts"

/**
 * The shop's tables: its orders, the support conversations and their messages (as the AI SDK's UI
 * messages, one row each), and the tickets the assistant opens. A ticket's reason may be left for
 * the studio to fill in when it triages, so the table takes one without; the assistant always
 * gives one, as `createTicket`'s schema requires. The test environment creates the tables in each
 * worker's database.
 */
export const SCHEMA = `
  create table if not exists orders (
    number text primary key,
    customer text not null,
    email text not null,
    item text not null,
    status text not null,
    placed_on date not null,
    arrives_on date
  );
  create table if not exists conversations (
    id text primary key,
    title text not null,
    created_at timestamptz not null default now()
  );
  create table if not exists messages (
    conversation_id text not null references conversations (id) on delete cascade,
    position int not null,
    id text not null,
    role text not null,
    message jsonb not null,
    primary key (conversation_id, position)
  );
  create table if not exists tickets (
    id bigint generated always as identity primary key,
    conversation_id text not null,
    order_number text not null,
    reason text,
    summary text not null,
    created_at timestamptz not null default now(),
    emailed_at timestamptz,
    unique (conversation_id, order_number)
  );
`

/** One pool for the server, kept across Next.js's module reloads in development. */
const shared = globalThis as typeof globalThis & { supportPool?: Pool }

function pool(): Pool {
  if (shared.supportPool === undefined) {
    const created = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2_000,
    })

    /* An idle connection that drops is replaced on the next query; it must not crash the server. */
    created.on("error", () => undefined)
    /* Nor may one that drops while checked out, between two statements of a transaction. */
    created.on("connect", (client) => client.on("error", () => undefined))
    shared.supportPool = created
  }

  return shared.supportPool
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

/** Runs one statement and returns its rows, retrying transient failures. */
export async function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  return withRetry(async () => (await pool().query<Row>(text, [...values])).rows, transient)
}

/**
 * Runs `work` in one transaction, and the whole transaction again on a transient failure, so
 * `work` must be safe to repeat: it may have committed before its answer was lost.
 */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withRetry(async () => {
    const client = await pool().connect()
    let broken = false

    try {
      await client.query("begin")

      const result = await work(client)

      await client.query("commit")

      return result
    } catch (error) {
      broken = true
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      /* A client whose connection failed is thrown away, not handed to the next caller. */
      client.release(broken)
    }
  }, transient)
}
