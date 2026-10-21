/**
 * Harbor's connection to Postgres, which Better Auth reads and writes through Kysely. Most of
 * Better Auth's work is one statement at a time, with a few short transactions. This pool retries
 * what the database failed for a moment, where running it again is safe:
 *
 * - a serialization failure or a deadlock on a statement: Postgres undid it, so it runs again;
 * - the same inside a transaction, the `COMMIT` included, or a connection lost before `COMMIT`:
 *   Postgres rolled the whole transaction back, so it runs again from `BEGIN` (on a fresh
 *   connection if need be), statement by statement. Each replayed statement must answer exactly
 *   as it did the first time, because Better Auth already acted on those answers; if one
 *   doesn't, the error stands;
 * - a connection lost under a `SELECT`: it runs again on a fresh connection;
 * - a connection lost under an `INSERT`: it runs again on a fresh connection, and when the retry
 *   finds the row already there (the first attempt landed and only its answer was lost), the row
 *   is read back by the id this app gave it, so the caller gets the row it wrote;
 * - a connection lost under a `DELETE` that returns nothing: deleting twice deletes the same rows.
 *
 * A lost `UPDATE`, `DELETE … RETURNING` or `COMMIT` is not retried: it may have happened, and
 * Better Auth's consumes and counters done twice are not the same as once.
 */
import pg from "pg"

import { describe, retrying } from "./retry.ts"

/** SQLSTATEs where Postgres undid the statement (or the transaction) and a fresh attempt can get past it. */
const UNDONE = new Set(["40001", "40P01"])

/** SQLSTATEs a new connection gets while the server is starting, stopping or full. */
const UNAVAILABLE = new Set(["57P01", "57P03", "53300", "08000", "08003", "08006"])

/** Words a driver error carries when the connection, not the statement, failed. */
const LOST_CONNECTION =
  /connection terminated|terminated unexpectedly|ECONNRESET|ECONNREFUSED|EPIPE|Connection ended|timeout/i

/** Up to 7 attempts, 100 ms apart and doubling to 1 s: long enough to ride out a few seconds' outage. */
const ATTEMPTS = 7

/** The SQLSTATE of a Postgres error, if it is one. */
function stateOf(error: unknown): string | undefined {
  return error instanceof pg.DatabaseError ? error.code : undefined
}

/** Whether Postgres undid the statement or transaction, so running it again is safe. */
function undone(error: unknown): boolean {
  return UNDONE.has(stateOf(error) ?? "")
}

/** Whether the connection failed, rather than the statement on it. */
function lostConnection(error: unknown): boolean {
  const state = stateOf(error)

  if (state !== undefined) return UNAVAILABLE.has(state)

  return error instanceof Error && LOST_CONNECTION.test(error.message)
}

/** The first word of a statement, upper-cased: `SELECT`, `INSERT`, `BEGIN` and so on. */
function verbOf(text: string): string {
  return /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase() ?? ""
}

/**
 * Whether a statement whose connection was lost can run again outside a transaction: a read; an
 * insert, which recognises its own row; or a delete that returns nothing, since deleting twice
 * deletes the same rows.
 */
function repeatable(verb: string, text: string): boolean {
  return (
    verb === "SELECT" || verb === "INSERT" || (verb === "DELETE" && !/\breturning\b/i.test(text))
  )
}

/** What a query answers. */
type Result = pg.QueryResult<pg.QueryResultRow>

/** A statement run inside the open transaction, and what it answered. */
interface Ran {
  readonly text: string
  readonly values: readonly unknown[]
  readonly answer: string
}

/** A result as text, to tell whether a replay answered the same. */
const answerOf = (result: Result) => JSON.stringify([result.rowCount, result.rows])

/**
 * For `insert into "table" ("id", …) values ($1, …)`, the statement that reads that row back by
 * its id; undefined when the insert names no id.
 */
function readBack(
  text: string,
  values: readonly unknown[],
): { text: string; values: unknown[] } | undefined {
  const match = /^\s*insert into ("[^"]+")\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(text)

  if (!match) return undefined

  const columns = (match[2] ?? "").split(",").map((column) => column.trim())
  const params = (match[3] ?? "").split(",").map((param) => param.trim())
  const at = columns.indexOf('"id"')
  const param = /^\$(\d+)$/.exec(params[at] ?? "")?.[1]

  if (at < 0 || param === undefined) return undefined

  return { text: `select * from ${match[1]} where "id" = $1`, values: [values[Number(param) - 1]] }
}

/** A pooled connection as Kysely sees it, with the retries above around each statement. */
class ResilientClient {
  private readonly pool: pg.Pool
  /** The connection underneath; a lost one is swapped for a fresh one mid-transaction. */
  private client: pg.PoolClient
  /** The open transaction's `BEGIN` and what ran in it since, or undefined outside one. */
  private transaction: { readonly begin: string; readonly ran: Ran[] } | undefined
  /** Whether the connection was lost, so releasing it throws it away. */
  private broken = false

  constructor(pool: pg.Pool, client: pg.PoolClient) {
    this.pool = pool
    this.client = client
  }

  /** Postgres's id for the connection's backend, which Kysely reads for cancelling. */
  get processID(): number | undefined {
    const id: unknown = Reflect.get(this.client, "processID")

    return typeof id === "number" ? id : undefined
  }

  async query(text: string, values: readonly unknown[] = []): Promise<Result> {
    const verb = verbOf(text)

    if (verb === "BEGIN" || verb === "START") {
      /* Nothing has happened yet, so a lost connection is retried on a fresh one. */
      const result = await retrying(
        { name: "postgres BEGIN", attempts: ATTEMPTS, retryable: lostConnection },
        async () => {
          if (this.broken) await this.reconnect()

          return this.run(text, values)
        },
      )

      this.transaction = { begin: text, ran: [] }

      return result
    }

    if (this.transaction) return this.inTransaction(this.transaction, text, values, verb)

    let again = false

    return retrying(
      {
        name: `postgres ${verb}`,
        attempts: ATTEMPTS,
        retryable: (error) => undone(error) || (lostConnection(error) && repeatable(verb, text)),
      },
      () => {
        const attempt = this.attempt(text, values, verb, again)

        again = true

        return attempt
      },
    )
  }

  /** Runs one statement on this connection, noting when the connection is lost. */
  private async run(text: string, values: readonly unknown[]): Promise<Result> {
    try {
      return await this.client.query(text, [...values])
    } catch (error) {
      if (lostConnection(error)) this.broken = true
      throw error
    }
  }

  /** One try outside a transaction: on this connection while it is sound, on a fresh one once lost. */
  private async attempt(
    text: string,
    values: readonly unknown[],
    verb: string,
    again: boolean,
  ): Promise<Result> {
    if (!this.broken) return this.run(text, values)

    const fresh = await this.pool.connect()
    let lost = false

    try {
      return await fresh.query(text, [...values])
    } catch (error) {
      lost = lostConnection(error)

      const back =
        again && verb === "INSERT" && stateOf(error) === "23505"
          ? readBack(text, values)
          : undefined
      const landed = back ? await fresh.query(back.text, back.values) : undefined

      if (landed && landed.rows.length > 0) {
        console.warn("postgres INSERT: an earlier attempt had landed; read it back")

        return { ...landed, command: "INSERT" }
      }
      throw error
    } finally {
      fresh.release(lost)
    }
  }

  /** Swaps a lost connection for a fresh one from the pool. */
  private async reconnect(): Promise<void> {
    this.client.release(true)
    this.client = await retrying(
      { name: "postgres connect", attempts: ATTEMPTS, retryable: lostConnection },
      () => this.pool.connect(),
    )
    this.broken = false
  }

  /**
   * A statement inside the open transaction, replayed from `BEGIN` when Postgres undid the
   * transaction: after a serialization failure or deadlock, or when the connection was lost
   * before `COMMIT` (Postgres rolls back an open transaction whose connection goes). A lost
   * `COMMIT` may have committed, so it is never replayed.
   */
  private async inTransaction(
    open: { readonly begin: string; readonly ran: Ran[] },
    text: string,
    values: readonly unknown[],
    verb: string,
  ): Promise<Result> {
    const ends = verb === "COMMIT" || verb === "ROLLBACK" || verb === "END"

    try {
      const result = await this.run(text, values).catch(async (error: unknown) => {
        const rolledBack = undone(error) || (lostConnection(error) && !ends)

        if (!rolledBack || verb === "ROLLBACK") throw error

        return this.replay(open, text, values, error)
      })

      open.ran.push({ text, values, answer: answerOf(result) })

      return result
    } finally {
      if (ends) this.transaction = undefined
    }
  }

  /**
   * Runs the transaction again from `BEGIN` after Postgres undid it, then the statement that
   * failed. Gives up with the first error when a replayed statement answers differently.
   */
  private async replay(
    open: { readonly begin: string; readonly ran: readonly Ran[] },
    text: string,
    values: readonly unknown[],
    first: unknown,
  ): Promise<Result> {
    const retryable = (error: unknown) => undone(error) || lostConnection(error)

    return retrying({ name: "postgres transaction", attempts: ATTEMPTS, retryable }, async () => {
      if (this.broken) await this.reconnect()
      else await this.run("rollback", []).catch(() => undefined)
      await this.run(open.begin, [])

      for (const ran of open.ran) {
        const again = await this.run(ran.text, ran.values)

        if (answerOf(again) !== ran.answer) {
          await this.run("rollback", []).catch(() => undefined)
          console.warn("postgres transaction: a replay answered differently; giving up")
          throw first
        }
      }

      return this.run(text, values)
    })
  }

  release(): void {
    this.transaction = undefined
    this.client.release(this.broken)
  }
}

/**
 * A `pg.Pool` as Kysely uses it: `connect()` waits out a database that is briefly down or full,
 * and each connection retries its statements as described above.
 */
export class ResilientPool {
  private readonly clients = new WeakMap<pg.PoolClient, ResilientClient>()
  private readonly pool: pg.Pool

  constructor(pool: pg.Pool) {
    this.pool = pool
  }

  get options(): object {
    return this.pool.options
  }

  async connect(): Promise<ResilientClient> {
    const client = await retrying(
      { name: "postgres connect", attempts: ATTEMPTS, retryable: lostConnection },
      () => this.pool.connect(),
    )
    /* Kysely keeps one connection object per client, so each client keeps one wrapper. */
    const known = this.clients.get(client)

    if (known) return known

    const wrapper = new ResilientClient(this.pool, client)

    this.clients.set(client, wrapper)

    return wrapper
  }

  end(): Promise<void> {
    return this.pool.end()
  }
}

/** The pool for `url`, which never lets a dropped connection end the process. */
export function connect(url: string): { pool: pg.Pool; resilient: ResilientPool } {
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  })

  /*
   * A connection the server or a proxy drops is not the app's crash. Idle, the pool replaces it;
   * checked out, the client says so with an 'error' event, which would end the process unheard.
   */
  pool.on("error", (error) => console.warn(`postgres: idle connection lost (${describe(error)})`))
  pool.on("connect", (client) =>
    client.on("error", (error) => console.warn(`postgres: connection lost (${describe(error)})`)),
  )

  return { pool, resilient: new ResilientPool(pool) }
}
