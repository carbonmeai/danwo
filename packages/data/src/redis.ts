/**
 * Redis and Valkey snapshots for `danwo matrix`: the snapshot is every key of one logical
 * database, serialised with `DUMP` together with its time to live; a restore empties that
 * database and puts every key back with `RESTORE`. Meant for the small datasets tests use
 * (sessions, rate-limit counters, queues), not for production-sized ones.
 */
import type { DatabaseSnapshot } from "./postgres.ts"
import { type Reply, RespClient } from "./resp.ts"

/** Which Redis or Valkey database `redisSnapshot` keeps and brings back. */
export interface RedisSnapshotOptions {
  /** A `redis://` URL; credentials in it are used. */
  readonly url: string
  /** The logical database to snapshot. Default: the URL's path (`/2`), else 0. */
  readonly db?: number
  /** Runs after every restore. */
  readonly onRestore?: () => Promise<void> | void
}

/** One key as `DUMP` serialised it, and its time to live in milliseconds (0 when it has none). */
interface KeptKey {
  readonly key: Buffer
  readonly payload: Buffer
  readonly ttl: number
}

function asBuffer(reply: Reply): Buffer {
  if (Buffer.isBuffer(reply)) return reply

  throw new Error("expected a bulk reply from Redis")
}

function asNumber(reply: Reply): number {
  if (typeof reply === "number") return reply

  throw new Error("expected an integer reply from Redis")
}

/** Every key in the selected database, through `SCAN`. */
async function allKeys(client: RespClient): Promise<Buffer[]> {
  const keys: Buffer[] = []
  let cursor = "0"

  do {
    const reply = await client.call("SCAN", cursor, "COUNT", "500")

    if (!Array.isArray(reply)) throw new Error("expected SCAN to answer with a list")

    const [next, batch] = reply

    cursor = asBuffer(next ?? null).toString()
    if (Array.isArray(batch)) keys.push(...batch.map((key) => asBuffer(key)))
  } while (cursor !== "0")

  return keys
}

async function keepKey(client: RespClient, key: Buffer): Promise<KeptKey | undefined> {
  const payload = await client.call("DUMP", key)

  if (payload === null) return undefined

  const ttl = asNumber(await client.call("PTTL", key))

  return { key, payload: asBuffer(payload), ttl: ttl > 0 ? ttl : 0 }
}

function dbOf(options: RedisSnapshotOptions): number {
  return options.db ?? (Number(new URL(options.url).pathname.slice(1)) || 0)
}

/**
 * A snapshot of one Redis or Valkey database for an environment's `snapshot()` and `restore()`.
 *
 * ```ts
 * const cache = redisSnapshot({ url: "redis://127.0.0.1:6379/0" })
 * ```
 */
export function redisSnapshot(options: RedisSnapshotOptions): DatabaseSnapshot {
  let client: Promise<RespClient> | undefined
  let kept: readonly KeptKey[] = []

  const open = () => {
    client ??= RespClient.open(options.url).then(async (opened) => {
      await opened.call("SELECT", String(dbOf(options)))

      return opened
    })

    return client
  }

  return {
    async snapshot() {
      const redis = await open()
      const keys = await allKeys(redis)
      const entries = await Promise.all(keys.map((key) => keepKey(redis, key)))

      kept = entries.filter((entry) => entry !== undefined)
    },
    async restore() {
      const redis = await open()

      await redis.call("FLUSHDB")
      await Promise.all(
        kept.map((entry) =>
          redis.call("RESTORE", entry.key, String(entry.ttl), entry.payload, "REPLACE"),
        ),
      )
      await options.onRestore?.()
    },
    async close() {
      const opened = await client

      client = undefined
      if (opened) opened.close()
    },
  }
}
