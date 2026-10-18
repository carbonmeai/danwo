/**
 * What a Redis command does: its name, the key it touches with ids folded, and its role for
 * planning faults. A key such as `coupon:WELCOME:user:42` reads `coupon:WELCOME:user:*`, so the
 * same command on another user's key is the same operation.
 */
import type { DataRole } from "../types.ts"

/** Commands that change data. */
const WRITES = new Set([
  "SET",
  "SETNX",
  "SETEX",
  "PSETEX",
  "GETSET",
  "GETDEL",
  "GETEX",
  "MSET",
  "MSETNX",
  "APPEND",
  "DEL",
  "UNLINK",
  "INCR",
  "INCRBY",
  "INCRBYFLOAT",
  "DECR",
  "DECRBY",
  "EXPIRE",
  "PEXPIRE",
  "EXPIREAT",
  "PEXPIREAT",
  "PERSIST",
  "RENAME",
  "HSET",
  "HSETNX",
  "HMSET",
  "HINCRBY",
  "HINCRBYFLOAT",
  "HDEL",
  "LPUSH",
  "RPUSH",
  "LPOP",
  "RPOP",
  "LREM",
  "LSET",
  "LTRIM",
  "SADD",
  "SREM",
  "SPOP",
  "SMOVE",
  "ZADD",
  "ZREM",
  "ZINCRBY",
  "ZPOPMIN",
  "ZPOPMAX",
  "XADD",
  "XACK",
  "XDEL",
  "PUBLISH",
  "EVAL",
  "EVALSHA",
  "FCALL",
])

/** Commands that end a transaction: what EXEC runs is the transaction's write. */
const BOUNDARIES = new Set(["EXEC"])

/** A client's own bookkeeping: never faulted by default. */
const HOUSEKEEPING = new Set([
  "PING",
  "ECHO",
  "INFO",
  "SELECT",
  "AUTH",
  "HELLO",
  "CLIENT",
  "COMMAND",
  "QUIT",
  "READONLY",
  "READWRITE",
  "CLUSTER",
  "CONFIG",
  "MULTI",
  "DISCARD",
  "WATCH",
  "UNWATCH",
  "SCRIPT",
  "FUNCTION",
  "MEMORY",
  "DBSIZE",
  "TIME",
  "FLUSHDB",
  "FLUSHALL",
])

/** Commands that put a connection into subscriber mode, after which it carries messages, not replies. */
export const SUBSCRIBES = new Set(["SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE"])

/** Commands whose first argument is not a key. */
const KEYLESS = new Set([...BOUNDARIES, ...HOUSEKEEPING, "EVAL", "EVALSHA", "FCALL", "PUBLISH"])

/** A key segment that names one record: digits, a uuid, a long token. */
const GENERATED = [/\d/, /^[0-9a-f]{8}-[0-9a-f]{4}-/i, /^[A-Za-z0-9_-]{16,}$/]

/** The key with segments that name one record folded to `*`. */
export function foldKey(key: string): string {
  return key
    .split(":")
    .map((segment) => (GENERATED.some((rule) => rule.test(segment)) ? "*" : segment))
    .join(":")
}

export interface Command {
  readonly verb: string
  readonly operation: string
  readonly role: DataRole
}

/** What a command with these words does. */
export function classifyCommand(words: readonly string[]): Command {
  const verb = (words[0] ?? "").toUpperCase()
  const key = KEYLESS.has(verb) ? undefined : words[1]
  const operation = key === undefined ? verb : `${verb} ${foldKey(key)}`

  if (BOUNDARIES.has(verb)) return { verb, operation, role: "boundary" }
  if (WRITES.has(verb)) return { verb, operation, role: "write" }
  if (HOUSEKEEPING.has(verb) || SUBSCRIBES.has(verb) || verb === "")
    return { verb, operation, role: "other" }

  return { verb, operation, role: "read" }
}
