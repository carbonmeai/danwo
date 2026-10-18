/**
 * How data faults read in reports, and the faults `danwo matrix` tries on each kind of call when
 * the config names none.
 */
import type { DataCallStart, DataFault } from "./types.ts"

/** Postgres SQLSTATEs danwo injects, by the name reports use. */
export const POSTGRES_ERRORS = {
  serialization_failure: {
    code: "40001",
    message: "could not serialize access due to concurrent update",
  },
  deadlock_detected: { code: "40P01", message: "deadlock detected" },
  too_many_connections: { code: "53300", message: "sorry, too many clients already" },
} as const

/** Redis error replies danwo injects, by prefix. */
export const REDIS_ERRORS = {
  OOM: "command not allowed when used memory > 'maxmemory'.",
  LOADING: "Redis is loading the dataset in memory",
  READONLY: "You can't write against a read only replica.",
} as const

const POSTGRES_NAMES = new Map<string, string>(
  Object.entries(POSTGRES_ERRORS).map(([name, { code }]) => [code, name]),
)

/** The fault in a few words: `reset-after`, `delay 5000ms`, `serialization_failure`, `OOM`. */
export function describeDataFault(fault: DataFault): string {
  if (fault.kind === "delay") return `delay ${fault.ms}ms`
  if (fault.kind === "error") return POSTGRES_NAMES.get(fault.code) ?? fault.code
  if (fault.kind === "down")
    return `${fault.refuse === "too-many-connections" ? "too_many_connections" : "down"} ${fault.ms}ms`

  return fault.kind
}

/** A Postgres error fault by its name, e.g. `pgError("serialization_failure")`. */
export function pgError(name: keyof typeof POSTGRES_ERRORS): DataFault {
  return { kind: "error", ...POSTGRES_ERRORS[name] }
}

/** A Redis error reply fault by its prefix, e.g. `redisError("OOM")`. */
export function redisError(prefix: keyof typeof REDIS_ERRORS): DataFault {
  return { kind: "error", code: prefix, message: REDIS_ERRORS[prefix] }
}

const LOST: readonly DataFault[] = [{ kind: "reset" }, { kind: "reset-after" }]
const SLOW: DataFault = { kind: "delay", ms: 5000 }

/**
 * The faults a Postgres call gets by default: writes can be lost before or after the server ran
 * them, run slow, or fail as a concurrent transaction would; a COMMIT can be lost or fail to
 * serialize; a BEGIN meets a database that is down or full. Reads and housekeeping get none.
 */
function postgresFaults(call: DataCallStart): readonly DataFault[] {
  if (call.role === "write")
    return [...LOST, SLOW, pgError("serialization_failure"), pgError("deadlock_detected")]
  if (call.verb === "COMMIT") return [...LOST, pgError("serialization_failure")]
  if (call.verb === "BEGIN")
    return [
      { kind: "down", ms: 3000 },
      { kind: "down", ms: 3000, refuse: "too-many-connections" },
    ]

  return []
}

/**
 * The faults a Redis command gets by default: writes can be lost before or after Redis ran them,
 * time out, or meet a full or read-only server; reads meet a server still loading, or a dropped
 * connection. Housekeeping (PING, SELECT, HELLO) gets none.
 */
function redisFaults(call: DataCallStart): readonly DataFault[] {
  if (call.role === "write" || call.role === "boundary")
    return [...LOST, SLOW, redisError("OOM"), redisError("READONLY")]
  if (call.role === "read") return [{ kind: "reset" }, redisError("LOADING")]

  return []
}

/** `danwo matrix`'s default data faults for a call, by the protocol it speaks. */
export function defaultDataFaults(call: DataCallStart): readonly DataFault[] {
  return call.kind === "postgres" ? postgresFaults(call) : redisFaults(call)
}
