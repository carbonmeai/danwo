/**
 * The `rows` restore of a Postgres snapshot: every table's rows are copied into a schema of the
 * app's own database, and a restore empties the tables and copies the rows back, in one
 * transaction, with the sequences set back too. No connection is closed, so it suits apps whose
 * pools treat a terminated connection as fatal. It costs more than a database copy for a big
 * database, and needs a role that may set `session_replication_role` (a superuser, as local and
 * CI servers usually run), so foreign keys and triggers do not fire while rows are copied back.
 */
import type { Client } from "pg"

import { SnapshotSlots } from "./slots.ts"

/** Where the rows are kept, inside the app's database: slot 0 here, slot n in `<SCHEMA>_<n>`. */
const SCHEMA = "danwo_snapshot"

/** The schema slot `n` keeps its rows in. */
function schemaOf(n: number): string {
  return n === 0 ? SCHEMA : `${SCHEMA}_${n}`
}

/** Leaves out the schemas the snapshot keeps its own copies in, by their shared prefix. */
const NOT_KEPT = (column: string) => `left(${column}, ${SCHEMA.length}) <> '${SCHEMA}'`

/** One table, the columns a copy may write (generated ones are left out), and its copy's name. */
interface KeptTable {
  readonly name: string
  readonly columns: readonly string[]
  readonly copy: string
}

/** A sequence and where it stood. */
interface KeptSequence {
  readonly name: string
  readonly value: string | null
  readonly called: boolean
}

/** A Postgres identifier, quoted. */
function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Every user table, schema-qualified and quoted, with the columns it can be written to, and the
 * name of its copy in `schema`.
 */
async function tablesOf(client: Client, schema: string): Promise<KeptTable[]> {
  const result = await client.query<{ schema: string; table: string; columns: string[] }>(
    `SELECT c.table_schema AS schema, c.table_name AS table,
            array_agg(c.column_name::text ORDER BY c.ordinal_position) AS columns
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND ${NOT_KEPT("c.table_schema")}
        AND c.is_generated = 'NEVER'
      GROUP BY c.table_schema, c.table_name
      ORDER BY 1, 2`,
  )

  return result.rows.map((row, index) => ({
    name: `${ident(row.schema)}.${ident(row.table)}`,
    columns: row.columns.map(ident),
    copy: `${ident(schema)}.${ident(`t${index}`)}`,
  }))
}

/** Every sequence's value. */
async function sequencesOf(client: Client): Promise<KeptSequence[]> {
  const result = await client.query<{ schema: string; name: string; value: string | null }>(
    `SELECT schemaname AS schema, sequencename AS name, last_value::text AS value
       FROM pg_sequences WHERE schemaname <> 'pg_catalog' AND ${NOT_KEPT("schemaname")}`,
  )

  return result.rows.map((row) => ({
    name: `${ident(row.schema)}.${ident(row.name)}`,
    value: row.value,
    called: row.value !== null,
  }))
}

/**
 * Inside the restore's transaction: empties every table, copies the kept rows back with foreign
 * keys and triggers off, and sets each sequence back to where it stood.
 */
async function putBack(
  db: Client,
  tables: readonly KeptTable[],
  sequences: readonly KeptSequence[],
): Promise<void> {
  await db.query("SET LOCAL session_replication_role = replica")
  if (tables.length > 0) await db.query(`TRUNCATE ${tables.map((t) => t.name).join(", ")}`)

  for (const table of tables) {
    const columns = table.columns.join(", ")

    await db.query(
      `INSERT INTO ${table.name} (${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM ${table.copy}`,
    )
  }

  for (const sequence of sequences)
    await db.query("SELECT setval($1::regclass, coalesce($2::bigint, 1), $3)", [
      sequence.name,
      sequence.value,
      sequence.called,
    ])
}

/** What a rows snapshot keeps between its `snapshot()` and `restore()`, one schema per slot. */
export interface RowsSnapshot {
  snapshot(slot?: string): Promise<void>
  restore(slot?: string): Promise<void>
  close(): Promise<void>
}

/** One slot's kept tables and sequences. */
interface KeptRows {
  readonly tables: readonly KeptTable[]
  readonly sequences: readonly KeptSequence[]
}

/** A rows snapshot of the database `connect` reaches, over a connection of its own. */
export function rowsSnapshot(connect: () => Promise<Client>): RowsSnapshot {
  let client: Promise<Client> | undefined
  const slots = new SnapshotSlots()
  const kept = new Map<number, KeptRows>()

  const session = () => {
    client ??= connect()

    return client
  }

  return {
    async snapshot(slot) {
      const db = await session()
      const n = slots.number(slot)
      const schema = schemaOf(n)

      await db.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`)
      await db.query(`CREATE SCHEMA ${ident(schema)}`)

      const tables = await tablesOf(db, schema)

      kept.set(n, { tables, sequences: await sequencesOf(db) })
      for (const table of tables)
        await db.query(
          `CREATE TABLE ${table.copy} AS SELECT ${table.columns.join(", ")} FROM ${table.name}`,
        )
    },
    async restore(slot) {
      const db = await session()
      const rows = kept.get(slots.kept(slot)) ?? { tables: [], sequences: [] }

      await db.query("BEGIN")

      try {
        await putBack(db, rows.tables, rows.sequences)
        await db.query("COMMIT")
      } catch (error) {
        await db.query("ROLLBACK")

        throw error
      }
    },
    async close() {
      const db = await client

      client = undefined
      if (db === undefined) return

      for (const n of slots.all())
        await db.query(`DROP SCHEMA IF EXISTS ${ident(schemaOf(n))} CASCADE`).catch(() => {})
      await db.end()
    },
  }
}
