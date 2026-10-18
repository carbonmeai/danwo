/**
 * Faults on the app's own data calls: the statements it sends its database and the commands it
 * sends its cache, through a data proxy. They are planned from the clean run like outbound faults,
 * by service, operation (`UPDATE orders`, `COMMIT`, `INCR rate:*`) and occurrence.
 */
import {
  type DataCall,
  type DataCallStart,
  type DataFault,
  type DataProxy,
  describeDataFault,
} from "@danwo/infra"

/** A fault on the n-th call of one operation to one data service. */
export interface DataPlannedFault {
  readonly target: "data"
  /** The data proxy's name, e.g. `postgres`, `cache`. */
  readonly service: string
  /** The verb and what it touches, ids folded: `UPDATE orders`, `COMMIT`, `GET session:*`. */
  readonly operation: string
  /** Which call of `operation` to `service` in the clean run, from 0. */
  readonly occurrence: number
  readonly fault: DataFault
  readonly label: string
}

/** Picks the faults to try on a data call of the clean run. */
export type DataFaultCatalogue = (call: DataCallStart) => readonly DataFault[]

/** How many times in a row the same read must come before it counts as a poll. */
const POLL_MIN_RUN = 3

/** The key a call is counted under: one service's one operation. */
const keyOf = (call: Pick<DataCall, "service" | "operation">) => `${call.service}|${call.operation}`

/**
 * Whether each call repeats a read that came just before it, in a row of at least three: a job
 * polling a table or a cache key. Only the first of such a row gets faults.
 */
function repeats(calls: readonly DataCall[]): boolean[] {
  const flags = calls.map(() => false)
  let start = 0

  for (let index = 1; index <= calls.length; index++) {
    const call = calls[index]
    const head = calls[start]

    if (call !== undefined && head?.role === "read" && keyOf(call) === keyOf(head)) continue
    if (index - start >= POLL_MIN_RUN) flags.fill(true, start + 1, index)
    start = index
  }

  return flags
}

/**
 * Every data call of the clean run × each fault `catalogue` gives it. A call that never got an
 * answer (the run ended first) is skipped, as is the housekeeping a driver does on its own.
 */
export function planDataFaults(
  calls: readonly DataCall[],
  catalogue: DataFaultCatalogue,
): DataPlannedFault[] {
  const counts = new Map<string, number>()
  const polls = repeats(calls)

  return calls.flatMap((call, index) => {
    const key = keyOf(call)
    const occurrence = counts.get(key) ?? 0

    counts.set(key, occurrence + 1)
    if (polls[index] === true || call.role === "other" || call.outcome === "pending") return []

    const nth = occurrence > 0 ? ` #${occurrence + 1}` : ""
    const poll = polls[index + 1] === true ? " (poll)" : ""

    return catalogue(call).map((fault) => ({
      target: "data" as const,
      service: call.service,
      operation: call.operation,
      occurrence,
      fault,
      label: `${describeDataFault(fault)} on ${call.operation}${nth} (${call.service})${poll}`,
    }))
  })
}

/** Sets the matching data proxy's rule so `planned` fires on its call. */
export function applyDataFault(
  proxies: readonly DataProxy[] | undefined,
  planned: DataPlannedFault,
): void {
  const proxy = proxies?.find((candidate) => candidate.service === planned.service)

  if (proxy === undefined)
    throw new Error(`no data proxy named ${planned.service}: ${planned.label}`)

  let seen = 0

  proxy.setFault((call) =>
    call.operation === planned.operation && seen++ === planned.occurrence
      ? planned.fault
      : undefined,
  )
}

/** Clears every data proxy's fault rule and any outage a fault started. */
export function clearDataFaults(proxies: readonly DataProxy[] | undefined): void {
  for (const proxy of proxies ?? []) proxy.setFault()
}

/** Every data proxy's calls in the order each proxy saw them, proxy by proxy. */
export function dataCallsOf(
  proxies: readonly DataProxy[] | undefined,
  marks: readonly number[] = [],
): DataCall[] {
  return (proxies ?? []).flatMap((proxy, at) => proxy.calls().slice(marks[at] ?? 0))
}
