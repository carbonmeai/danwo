/**
 * SQL on a test database, for emptying it and for invariants that read what the jobs saved. It
 * connects straight to Postgres, never through danwo's data proxy, so the fault matrix never
 * faults a test's own reads.
 */
import pg from "pg"

/** Runs one statement and returns its rows. */
export type Sql = <Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) => Promise<Row[]>

/** Throws unless `url` names a database made for tests: a reset empties its tables. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1)

  if (!name.endsWith("_test"))
    throw new Error(`not a test database: ${name} (it must end in _test)`)
}

/** A `sql` helper for the database at `url`; it opens a connection per statement. */
export function sqlOn(url: string): Sql {
  assertTestDatabase(url)

  return async <Row extends pg.QueryResultRow>(text: string, values: readonly unknown[] = []) => {
    const client = new pg.Client({ connectionString: url })

    await client.connect()
    try {
      return (await client.query<Row>(text, [...values])).rows
    } finally {
      await client.end()
    }
  }
}
