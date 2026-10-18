/**
 * Postgres snapshots for `danwo matrix`: the app's database is copied once into a template
 * database, and every trial gets a fresh copy of that template back. Copying a database inside
 * the server is a file-level copy, so a restore costs milliseconds where re-running migrations,
 * seeds and an app restart costs much more as the schema grows.
 *
 * The app keeps its own connection string throughout. A restore closes the sessions on its
 * database and puts another database in its place, so the app's pool must open new connections
 * when an old one is closed under it. Most pools do; give `pg.Pool` an `error` listener so a
 * closed idle client is not fatal, or reset the pool from `onRestore`.
 */
import { setTimeout as sleep } from "node:timers/promises"

import type { Client } from "pg"

/** How a restore brings the database back. */
export type PostgresRestoreStrategy = "recreate" | "swap"

/** Which Postgres database `postgresSnapshot` keeps and brings back, and how. */
export interface PostgresSnapshotOptions {
  /** A connection URL for the app's database: its server, credentials and, by default, its name. */
  readonly url: string
  /** The app's database. Default: the database named in `url`. */
  readonly database?: string
  /** Where the snapshot is kept. Default: `<database>_danwo_snapshot`. */
  readonly template?: string
  /** The database the helper connects to for DROP and CREATE. Default: `postgres`. */
  readonly adminDatabase?: string
  /**
   * `recreate` (default) moves the app's database aside and copies the template into its place
   * during the restore, tens of milliseconds for a test-sized database. `swap` keeps a spare copy
   * ready so a restore is two renames, and copies the next spare while the trial runs: it pays
   * off for large databases and long trials, and costs a second copy on disk.
   */
  readonly strategy?: PostgresRestoreStrategy
  /** Runs after every restore, e.g. to tell the app to drop its pooled connections. */
  readonly onRestore?: () => Promise<void> | void
}

/** What an environment's `snapshot()` and `restore()` call, plus `close()` for its own connection. */
export interface DatabaseSnapshot {
  /** Keeps the database as it is now. Connections to it are closed while it is copied. */
  snapshot(): Promise<void>
  /** Brings back what `snapshot()` kept; connections to the database are closed. */
  restore(): Promise<void>
  /** Closes the helper's own connections and drops the databases it made. */
  close(): Promise<void>
}

/** A Postgres identifier, quoted. */
function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** `url` pointing at `database` instead. */
function databaseUrl(url: string, database: string): string {
  const next = new URL(url)

  next.pathname = `/${encodeURIComponent(database)}`

  return next.toString()
}

/** The database a URL names. */
function databaseOf(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.slice(1))

  if (name === "") throw new Error(`no database named in ${new URL(url).origin}`)

  return name
}

/** Loads `pg`'s client, an optional peer dependency, with a clear message when it is missing. */
async function loadClient(): Promise<typeof Client> {
  try {
    return (await import("pg")).Client
  } catch {
    throw new Error("postgres snapshots need the `pg` package: add it to your dev dependencies")
  }
}

/** A connection to the server's admin database, opened on first use and kept. */
class AdminConnection {
  readonly #url: string
  #client: Promise<Client> | undefined

  constructor(url: string, adminDatabase: string) {
    this.#url = databaseUrl(url, adminDatabase)
  }

  async query(sql: string, values: readonly unknown[] = []): Promise<void> {
    const client = await this.#connect()

    await client.query(sql, [...values])
  }

  /** How many other sessions are connected to `database`. */
  async sessionsOn(database: string): Promise<number> {
    const client = await this.#connect()
    const result = await client.query<{ sessions: number }>(
      "SELECT count(*)::int AS sessions FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database],
    )

    return result.rows[0]?.sessions ?? 0
  }

  async close(): Promise<void> {
    const client = await this.#client

    this.#client = undefined
    await client?.end()
  }

  #connect(): Promise<Client> {
    this.#client ??= loadClient().then(async (PgClient) => {
      const client = new PgClient({ connectionString: this.#url })

      await client.connect()

      return client
    })

    return this.#client
  }
}

/**
 * Closes every other session on `database`, waits until they are gone, and keeps new ones out
 * until `allow` runs. The wait is a short poll of its own: a DROP, a rename or Postgres's own
 * waiting termination would otherwise sleep a tenth of a second per check.
 */
async function shutOut(admin: AdminConnection, database: string): Promise<void> {
  await admin.query(`ALTER DATABASE ${ident(database)} WITH ALLOW_CONNECTIONS false`)
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [database],
  )

  for (let waited = 0; waited < 5000; waited += 2) {
    if ((await admin.sessionsOn(database)) === 0) return
    await sleep(2)
  }

  throw new Error(`sessions on ${database} did not close within 5 s`)
}

async function allow(admin: AdminConnection, database: string): Promise<void> {
  await admin.query(`ALTER DATABASE ${ident(database)} WITH ALLOW_CONNECTIONS true`)
}

/** Replaces `target` with a fresh copy of `template`. */
async function copyOf(admin: AdminConnection, target: string, template: string): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${ident(target)} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${ident(target)} TEMPLATE ${ident(template)}`)
}

/** Copies `database` into `template` while nobody else is connected to it. */
async function keep(admin: AdminConnection, database: string, template: string): Promise<void> {
  await shutOut(admin, database)

  try {
    await copyOf(admin, template, database)
  } finally {
    await allow(admin, database)
  }
}

/** Database names a snapshot works with. */
interface Names {
  readonly database: string
  readonly template: string
  readonly spare: string
  /** A name for a database a restore moved aside, unique per restore. */
  readonly retired: (n: number) => string
}

function namesOf(options: PostgresSnapshotOptions): Names {
  const database = options.database ?? databaseOf(options.url)

  return {
    database,
    template: options.template ?? `${database}_danwo_snapshot`,
    spare: `${database}_danwo_spare`,
    retired: (n) => `${database}_danwo_retired_${n}`,
  }
}

/**
 * Background work on a connection of its own, one job at a time: copying the next spare and
 * dropping databases a restore moved aside. A DROP can take a quarter of a second, so it never
 * runs on the connection a restore is waiting on.
 */
class Background {
  readonly #admin: AdminConnection
  #queue: Promise<void> = Promise.resolve()

  constructor(admin: AdminConnection) {
    this.#admin = admin
  }

  /** Queues `job`; resolves when it is done. */
  run(job: (admin: AdminConnection) => Promise<void>): Promise<void> {
    const done = this.#queue.then(() => job(this.#admin))

    this.#queue = done.catch(() => {})

    return done
  }

  async close(): Promise<void> {
    await this.#queue
    await this.#admin.close()
  }
}

/** Moves the app's database aside under a fresh name and drops it in the background. */
class Retirer {
  readonly #names: Names
  readonly #background: Background
  #count = 0

  constructor(names: Names, background: Background) {
    this.#names = names
    this.#background = background
  }

  /** Renames the app's database aside; resolves to the name `drop` takes later. */
  async retire(admin: AdminConnection): Promise<string> {
    const retired = this.#names.retired(this.#count++)

    await admin.query(`ALTER DATABASE ${ident(this.#names.database)} RENAME TO ${ident(retired)}`)

    return retired
  }

  /** Queues dropping a retired database behind whatever the background is already doing. */
  drop(retired: string): void {
    void this.#background.run((other) =>
      other.query(`DROP DATABASE IF EXISTS ${ident(retired)} WITH (FORCE)`),
    )
  }
}

/** How a strategy readies itself after a snapshot and brings the database back. */
interface Strategy {
  prepare(): Promise<void>
  restore(): Promise<void>
  cleanUp(): Promise<void>
}

/** Restores by moving the app's database aside and copying the template into its place. */
function recreating(admin: AdminConnection, names: Names, retirer: Retirer): Strategy {
  return {
    prepare: async () => {},
    restore: async () => {
      await shutOut(admin, names.database)

      const retired = await retirer.retire(admin)

      await admin.query(
        `CREATE DATABASE ${ident(names.database)} TEMPLATE ${ident(names.template)}`,
      )
      retirer.drop(retired)
    },
    cleanUp: async () => {},
  }
}

/**
 * Restores by renaming a spare copy into place: the next spare is copied in the background while
 * the trial runs, so a restore is two renames unless the trial was shorter than that copy.
 */
function swapping(
  admin: AdminConnection,
  names: Names,
  retirer: Retirer,
  background: Background,
): Strategy {
  let ready: Promise<void> = Promise.resolve()

  const nextSpare = () => {
    ready = background.run((other) => copyOf(other, names.spare, names.template))
  }

  return {
    prepare: async () => {
      nextSpare()
      await ready
    },
    restore: async () => {
      await ready
      await shutOut(admin, names.database)

      const retired = await retirer.retire(admin)

      await admin.query(`ALTER DATABASE ${ident(names.spare)} RENAME TO ${ident(names.database)}`)
      // The next spare first, so the next restore never waits behind a drop.
      nextSpare()
      retirer.drop(retired)
    },
    cleanUp: async () => {
      await ready.catch(() => {})
      await admin.query(`DROP DATABASE IF EXISTS ${ident(names.spare)} WITH (FORCE)`)
    },
  }
}

/**
 * A snapshot of a Postgres database for an environment's `snapshot()` and `restore()`. Needs a
 * role that may create databases, and Postgres 14 or later.
 *
 * ```ts
 * const db = postgresSnapshot({ url: process.env.DATABASE_URL })
 * return { ..., snapshot: () => db.snapshot(), restore: () => db.restore(), close: () => db.close() }
 * ```
 */
export function postgresSnapshot(options: PostgresSnapshotOptions): DatabaseSnapshot {
  const names = namesOf(options)
  const adminDatabase = options.adminDatabase ?? "postgres"
  const admin = new AdminConnection(options.url, adminDatabase)
  const background = new Background(new AdminConnection(options.url, adminDatabase))
  const retirer = new Retirer(names, background)
  const strategy =
    options.strategy === "swap"
      ? swapping(admin, names, retirer, background)
      : recreating(admin, names, retirer)

  return {
    async snapshot() {
      await keep(admin, names.database, names.template)
      await strategy.prepare()
    },
    async restore() {
      await strategy.restore()
      await options.onRestore?.()
    },
    async close() {
      await strategy.cleanUp()
      await background.close()
      await admin.query(`DROP DATABASE IF EXISTS ${ident(names.template)}`)
      await admin.close()
    },
  }
}

/** Where `postgresWorkerDatabase` copies each worker's database from. */
export interface WorkerDatabaseOptions {
  /** The database every worker's copy starts from. Default: the database named in `url`. */
  readonly base?: string
  /** The database the helper connects to for CREATE. Default: `postgres`. */
  readonly adminDatabase?: string
}

/**
 * A database of its own for one worker, `<base>_w<workerIndex>`, copied fresh from `base`, so
 * parallel workers never share rows. Resolves to its connection URL. Run migrations and seeds on
 * `base` first: nobody may be connected to it while the copy is made.
 *
 * ```ts
 * async environment({ workerIndex }) {
 *   const url = await postgresWorkerDatabase(process.env.DATABASE_URL, workerIndex)
 *   const db = postgresSnapshot({ url })
 *   // start the app with DATABASE_URL=url, then snapshot and restore `db`
 * }
 * ```
 */
export async function postgresWorkerDatabase(
  url: string,
  workerIndex: number,
  options: WorkerDatabaseOptions = {},
): Promise<string> {
  const base = options.base ?? databaseOf(url)
  const name = `${base}_w${workerIndex}`
  const admin = new AdminConnection(url, options.adminDatabase ?? "postgres")

  try {
    await copyOf(admin, name, base)
  } finally {
    await admin.close()
  }

  return databaseUrl(url, name)
}
