/**
 * The orders app's database: its migration, run once on the base database, and a "full reset"
 * that rebuilds a database from nothing the way an app without snapshots would between runs.
 */
import { Client } from "pg"

/** The schema and seed data: an orders table plus a product catalogue to make the copy real. */
const MIGRATION = `
  CREATE TABLE products (id serial PRIMARY KEY, name text NOT NULL, price_cents integer NOT NULL);
  INSERT INTO products (name, price_cents)
    SELECT 'product ' || n, 100 + n FROM generate_series(1, 2000) AS n;
  CREATE TABLE orders (id serial PRIMARY KEY, payment_intent text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`

/** `url` pointing at `database`. */
export function withDatabase(url: string, database: string): string {
  const next = new URL(url)

  next.pathname = `/${database}`

  return next.toString()
}

async function onAdmin(url: string, sql: string): Promise<void> {
  const admin = new Client({ connectionString: withDatabase(url, "postgres") })

  await admin.connect()

  try {
    await admin.query(sql)
  } finally {
    await admin.end()
  }
}

/** Drops and creates `database` on the server of `url`, then migrates and seeds it. */
export async function rebuild(url: string, database: string): Promise<void> {
  await onAdmin(url, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
  await onAdmin(url, `CREATE DATABASE "${database}"`)

  const client = new Client({ connectionString: withDatabase(url, database) })

  await client.connect()

  try {
    await client.query(MIGRATION)
  } finally {
    await client.end()
  }
}
