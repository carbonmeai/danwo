import { type DataCall, type DataFaultRule, type DataProxy, defaultDataFaults } from "@danwo/infra"
import { describe, expect, it } from "vitest"

import { applyDataFault, planDataFaults } from "../src/data-faults.ts"
import { checkFaultFired, type RunOutcome } from "../src/fault-matrix.ts"

function call(operation: string, role: DataCall["role"], more: Partial<DataCall> = {}): DataCall {
  const verb = operation.split(" ")[0] ?? operation

  return {
    service: "postgres",
    kind: "postgres",
    operation,
    verb,
    role,
    inTransaction: role !== "boundary" || verb === "COMMIT",
    connection: 1,
    startedAt: "2026-10-19T00:00:00.000Z",
    durationMs: 1,
    outcome: "ok",
    fault: null,
    ...more,
  }
}

const checkout = [
  call("SET", "other"),
  call("BEGIN", "boundary"),
  call("SELECT orders", "read"),
  call("UPDATE accounts", "write"),
  call("INSERT orders", "write"),
  call("COMMIT", "boundary"),
]

describe("planDataFaults", () => {
  it("plans the default faults on writes, COMMIT and BEGIN, none on reads or housekeeping", () => {
    const labels = planDataFaults(checkout, defaultDataFaults).map((fault) => fault.label)

    expect(labels).toEqual([
      "down 3000ms on BEGIN (postgres)",
      "too_many_connections 3000ms on BEGIN (postgres)",
      "reset on UPDATE accounts (postgres)",
      "reset-after on UPDATE accounts (postgres)",
      "delay 5000ms on UPDATE accounts (postgres)",
      "serialization_failure on UPDATE accounts (postgres)",
      "deadlock_detected on UPDATE accounts (postgres)",
      "reset on INSERT orders (postgres)",
      "reset-after on INSERT orders (postgres)",
      "delay 5000ms on INSERT orders (postgres)",
      "serialization_failure on INSERT orders (postgres)",
      "deadlock_detected on INSERT orders (postgres)",
      "reset on COMMIT (postgres)",
      "reset-after on COMMIT (postgres)",
      "serialization_failure on COMMIT (postgres)",
    ])
  })

  it("numbers repeats and plans a poll's first read only", () => {
    const calls = [
      call("COMMIT", "boundary"),
      call("COMMIT", "boundary"),
      call("GET jobs:*", "read", { service: "cache", kind: "redis" }),
      call("GET jobs:*", "read", { service: "cache", kind: "redis" }),
      call("GET jobs:*", "read", { service: "cache", kind: "redis" }),
      call("UPDATE orders", "write", { outcome: "pending" }),
    ]
    const plan = planDataFaults(calls, (c) => (c.role === "write" ? [] : [{ kind: "reset" }]))

    expect(plan.map((fault) => [fault.label, fault.occurrence])).toEqual([
      ["reset on COMMIT (postgres)", 0],
      ["reset on COMMIT #2 (postgres)", 1],
      ["reset on GET jobs:* (cache) (poll)", 0],
    ])
  })
})

/** A data proxy that only keeps the rule it was given. */
function fakeProxy(service: string): DataProxy & { rule: DataFaultRule | undefined } {
  return {
    service,
    kind: "postgres",
    host: "127.0.0.1",
    port: 1,
    rule: undefined,
    url: (url) => url,
    calls: () => [],
    setFault(rule) {
      this.rule = rule
    },
    clear() {},
    dropConnections() {},
    close: async () => undefined,
  }
}

describe("applyDataFault", () => {
  it("fires on the planned occurrence of the operation only", () => {
    const proxy = fakeProxy("postgres")
    const [planned] = planDataFaults(
      [call("COMMIT", "boundary"), call("COMMIT", "boundary")],
      () => [{ kind: "reset-after" }],
    ).slice(1)

    if (planned === undefined) throw new Error("no plan")
    applyDataFault([fakeProxy("cache"), proxy], planned)

    const start = { ...call("COMMIT", "boundary") }

    expect(proxy.rule?.(call("UPDATE orders", "write"))).toBeUndefined()
    expect(proxy.rule?.(start)).toBeUndefined()
    expect(proxy.rule?.(start)).toEqual({ kind: "reset-after" })
    expect(proxy.rule?.(start)).toBeUndefined()
    expect(() => applyDataFault([], planned)).toThrow(/no data proxy named postgres/)
  })

  it("marks a run invalid when no data call carried the fault", () => {
    const [fault] = planDataFaults([call("COMMIT", "boundary")], () => [{ kind: "reset" }])

    if (fault === undefined) throw new Error("no plan")

    const outcome: RunOutcome = {
      fault,
      status: "passed",
      error: null,
      exchanges: [],
      deliveries: [],
      dataCalls: [call("COMMIT", "boundary")],
      notes: [],
    }

    expect(checkFaultFired(outcome).status).toBe("invalid")
    expect(checkFaultFired(outcome).error).toContain("no database or cache call matched")
    expect(
      checkFaultFired({
        ...outcome,
        dataCalls: [call("COMMIT", "boundary", { fault: fault.label, outcome: "reset" })],
      }).status,
    ).toBe("passed")
  })
})
