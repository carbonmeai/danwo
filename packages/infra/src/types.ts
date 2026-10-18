/**
 * What a data proxy records and how its faults are described: one `DataCall` per statement or
 * command the app sent its database or cache, and the `DataFault`s `danwo matrix` can put on one.
 */

/** The protocols a data proxy speaks. */
export type DataKind = "postgres" | "redis"

/**
 * What a call does, for planning faults: `write` changes data (INSERT, SET), `boundary` opens or
 * ends a transaction (BEGIN, COMMIT, EXEC), `read` only reads, `other` is a driver's own
 * housekeeping (SET search_path, PING, SELECT 1 on connect) that the matrix leaves alone.
 */
export type DataRole = "write" | "boundary" | "read" | "other"

/** A call as it starts, before the server answers: what a fault rule decides on. */
export interface DataCallStart {
  /** The proxy's name, e.g. `postgres` or `cache`. */
  readonly service: string
  readonly kind: DataKind
  /** The verb and what it touches, ids folded: `UPDATE orders`, `COMMIT`, `SET coupon:*`. */
  readonly operation: string
  /** The verb alone: `UPDATE`, `COMMIT`, `SET`. */
  readonly verb: string
  readonly role: DataRole
  /** Whether a transaction was open on the connection when the call was sent. */
  readonly inTransaction: boolean
  /** Which client connection sent it, from 1, in the order they connected. */
  readonly connection: number
}

/** A call and how it ended. */
export interface DataCall extends DataCallStart {
  /** When the app sent it. */
  readonly startedAt: string
  /** Milliseconds until the server's answer reached the app, null while pending or when none did. */
  readonly durationMs: number | null
  /**
   * `ok`: answered. `error`: answered with an error (the server's or an injected one). `reset`:
   * the connection was dropped before the app saw an answer. `pending`: no answer yet.
   */
  readonly outcome: "ok" | "error" | "reset" | "pending"
  /** The error's code when it ended in one: a SQLSTATE (`40001`) or a Redis prefix (`OOM`). */
  readonly error?: string
  /** The fault put on this call, as its label describes it, or null. */
  readonly fault: string | null
}

/**
 * A fault on one call:
 * - `reset`: the connection is dropped before the call reaches the server;
 * - `reset-after`: the server runs the call, then the connection is dropped before the app sees
 *   the answer (on COMMIT: committed, but the app cannot know);
 * - `delay`: the call reaches the server `ms` late;
 * - `error`: the server is not asked; the app gets an error with `code` (a SQLSTATE such as
 *   `40001`, or a Redis prefix such as `OOM`);
 * - `down`: the connection is dropped and new ones fail for `ms`: refused outright, or, for
 *   Postgres, turned away with `too_many_connections`.
 */
export type DataFault =
  | { readonly kind: "reset" }
  | { readonly kind: "reset-after" }
  | { readonly kind: "delay"; readonly ms: number }
  | { readonly kind: "error"; readonly code: string; readonly message?: string }
  | {
      readonly kind: "down"
      readonly ms: number
      readonly refuse?: "close" | "too-many-connections"
    }

/** Picks the fault for a call as it starts, if any. */
export type DataFaultRule = (call: DataCallStart) => DataFault | undefined

/** A running data proxy: the address the app connects to instead of its database or cache. */
export interface DataProxy {
  readonly service: string
  readonly kind: DataKind
  readonly host: string
  readonly port: number
  /** `upstreamUrl` with its host and port swapped for the proxy's, for the app's config. */
  url(upstreamUrl: string): string
  /** Every call since the proxy started or was last cleared, in the order they were sent. */
  calls(): readonly DataCall[]
  /** The rule faulting calls from now on; undefined turns faults off. */
  setFault(rule?: DataFaultRule): void
  /** Forgets the calls and the fault rule, and ends any `down` window. */
  clear(): void
  /** Drops every open connection between the app and the server. */
  dropConnections(): void
  close(): Promise<void>
}
