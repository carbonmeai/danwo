/**
 * Reads the API's database from a test. It connects straight to the worker's database, never
 * through danwo's data proxy, so the matrix's faults never land on a test's own reads.
 */
import { Client, type QueryResultRow } from "pg"

/** Fails unless `url` names a database made for tests: its name ends in `_test`. */
export function assertTestDatabase(url: string): void {
  if (!new URL(url).pathname.endsWith("_test")) throw new Error(`not a test database: ${url}`)
}

/** Runs one statement on the test database at `url` and returns its rows. */
export async function sql<Row extends QueryResultRow = QueryResultRow>(
  url: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  assertTestDatabase(url)

  const client = new Client({ connectionString: url })

  await client.connect()
  try {
    return (await client.query<Row>(text, [...values])).rows
  } finally {
    await client.end()
  }
}
