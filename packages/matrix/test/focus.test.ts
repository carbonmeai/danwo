import { type DataCall, defaultDataFaults } from "@danwo/infra"
import type { Exchange, OutboundCall, OutboundFault } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { planFaults, type PlannedFault, type RunOutcome } from "../src/fault-matrix.ts"
import { bodyOf, focusLines, focusPlan, isBackground, setupSize, tierOf } from "../src/focus.ts"

function exchange(method: string, host: string, path: string, at: number): Exchange {
  return {
    disposition: "routed",
    method,
    host,
    path,
    startedAt: new Date(at).toISOString(),
    id: `e${at}`,
    client: "server",
    fault: null,
    status: 200,
    durationMs: 1,
    aborted: false,
  }
}

function statement(operation: string, role: DataCall["role"], service = "postgres"): DataCall {
  return {
    service,
    kind: "postgres",
    operation,
    verb: operation.split(" ")[0] ?? operation,
    role,
    inTransaction: true,
    connection: 1,
    startedAt: new Date(0).toISOString(),
    durationMs: 1,
    outcome: "ok",
    fault: null,
  }
}

function outcome(more: Partial<RunOutcome>): RunOutcome {
  return {
    fault: null,
    status: "passed",
    error: null,
    exchanges: [],
    deliveries: [],
    notes: [],
    ...more,
  }
}

/** A provider's catalogue: a 5xx and a lost answer on every call, a decline and a delay on writes. */
function catalogue(call: OutboundCall): readonly OutboundFault[] {
  const both: OutboundFault[] = [{ kind: "status", status: 500 }, { kind: "reset" }]

  return call.method === "GET"
    ? both
    : [
        { kind: "emulate", behaviour: "card_declined" },
        ...both,
        { kind: "reset-after" },
        { kind: "delay", ms: 30_000 },
      ]
}

/**
 * A session's sign-in (setup), then a body that saves a task, polls nothing, and writes the same
 * row kind many times over: the shape of a real app's clean run.
 */
function realisticRun(): RunOutcome {
  const signIn = [
    exchange("POST", "clerk.test", "/v1/client/sign_ins", 1),
    exchange("GET", "clerk.test", "/v1/environment", 2),
    exchange("GET", "clerk.test", "/.well-known/jwks.json", 3),
  ]
  const body = [
    exchange("POST", "clerk.test", "/v1/client/sessions/sess_4f8a9b0c1d2e3f4a/tokens", 4),
    exchange("GET", "api.test", "/health", 5),
    exchange("POST", "api.stripe.com", "/v1/customers", 6),
    exchange("POST", "api.stripe.com", "/v1/subscriptions", 7),
    exchange("GET", "api.stripe.com", "/v1/prices", 8),
    exchange("POST", "clerk.test", "/v1/client/sign_ins", 9),
  ]
  const setupData = Array.from({ length: 20 }, () => statement("INSERT sessions", "write"))
  const bodyData = [
    ...Array.from({ length: 30 }, (_, at) =>
      statement(at % 2 === 0 ? "INSERT tasks" : "UPDATE tasks", "write"),
    ),
    statement("SELECT tasks", "read"),
    statement("COMMIT", "boundary"),
  ]

  return outcome({
    exchanges: [...signIn, ...body],
    dataCalls: [...setupData, ...bodyData],
    setup: {
      exchanges: signIn.length,
      deliveries: 0,
      sockets: 0,
      data: { postgres: setupData.length },
    },
  })
}

function plan(run: RunOutcome): PlannedFault[] {
  return planFaults(run, catalogue, [], defaultDataFaults)
}

describe("bodyOf", () => {
  it("leaves out what came before the body, statement by statement for each data service", () => {
    const run = outcome({
      exchanges: [exchange("POST", "a.test", "/x", 1), exchange("POST", "a.test", "/y", 2)],
      dataCalls: [
        statement("INSERT a", "write"),
        statement("SET k", "write", "cache"),
        statement("INSERT b", "write"),
        statement("SET j", "write", "cache"),
      ],
      setup: { exchanges: 1, deliveries: 0, sockets: 0, data: { postgres: 1, cache: 0 } },
    })
    const body = bodyOf(run)

    expect(body.exchanges.map((e) => e.path)).toEqual(["/y"])
    expect(body.dataCalls?.map((c) => c.operation)).toEqual(["SET k", "INSERT b", "SET j"])
    expect(body.setup).toBeUndefined()
    expect(setupSize(run.setup)).toBe(2)
  })

  it("counts occurrences from the body, where a trial arms its fault", () => {
    const faults = plan(bodyOf(realisticRun())).filter(
      (fault) => fault.target === "outbound" && fault.route.includes("sign_ins"),
    )

    // The sign-in route ran once in setup and once in the body: the body's is its first.
    expect(faults.length).toBeGreaterThan(0)
    expect(faults.every((fault) => "occurrence" in fault && fault.occurrence === 0)).toBe(true)
  })

  it("plans nothing on what setup set off, still counting it for the body's own occurrences", () => {
    const run = outcome({
      exchanges: [
        exchange("POST", "a.test", "/sign_in", 1),
        exchange("POST", "api.stripe.com", "/v1/customers", 2),
        exchange("POST", "api.stripe.com", "/v1/customers", 3),
      ],
      dataCalls: [
        statement("INSERT sessions", "write"),
        statement("INSERT users", "write"),
        statement("INSERT users", "write"),
      ],
      setup: {
        exchanges: 1,
        deliveries: 0,
        sockets: 0,
        data: { postgres: 1 },
        caused: { exchanges: [1], deliveries: [], data: [1], sockets: [] },
      },
    })
    const body = bodyOf(run)
    const faults = plan(body)
    const customers = faults.filter((fault) => fault.label.includes("/v1/customers"))
    const users = faults.filter((fault) => fault.label.includes("INSERT users"))

    expect(body.caused).toEqual({ exchanges: [0], deliveries: [], data: [0], sockets: [] })
    expect(customers.length).toBeGreaterThan(0)
    expect(customers.every((fault) => "occurrence" in fault && fault.occurrence === 1)).toBe(true)
    expect(users.length).toBeGreaterThan(0)
    expect(users.every((fault) => "occurrence" in fault && fault.occurrence === 1)).toBe(true)
    expect(setupSize(run.setup)).toBe(4)
  })
})

describe("focusPlan", () => {
  it("keeps every fault, background work included, while the plan is within its budget", () => {
    const body = plan(bodyOf(realisticRun()))
    const focused = focusPlan(body, 0, { budget: 10_000 })

    expect(focused.trials).toHaveLength(body.length)
    expect(focused.skipped).toEqual({ setup: 0, background: 0, repeats: 0, kinds: 0, budget: [] })
  })

  it("drops background work first once the plan is over its budget", () => {
    const body = plan(bodyOf(realisticRun()))
    const focused = focusPlan(body, 0, { budget: body.length - 1 })

    expect(focused.skipped.background).toBeGreaterThan(0)
    expect(focused.trials.some(isBackground)).toBe(false)
  })

  it("folds repeats, thins kinds and cuts at the budget, writes and races first", () => {
    const run = realisticRun()
    const full = plan(run)
    const body = plan(bodyOf(run))
    const focused = focusPlan(body, full.length - body.length, { budget: 12 })

    expect(full.length).toBeGreaterThan(200)
    expect(focused.trials).toHaveLength(12)
    expect(focused.total).toBe(full.length)
    expect(focused.skipped.setup).toBe(full.length - body.length)
    expect(focused.skipped.repeats).toBeGreaterThan(0)
    expect(focused.skipped.kinds).toBeGreaterThan(0)
    expect(focused.trials.every((fault) => tierOf(fault) <= 1)).toBe(true)
    expect(focused.trials.some((fault) => fault.label.includes("INSERT tasks"))).toBe(true)
    expect(
      focused.trials.some((fault) => fault.label.includes("POST api.stripe.com/v1/customers")),
    ).toBe(true)
    expect(focused.trials.every((fault) => !fault.label.includes("#"))).toBe(true)
    expect(focusLines(focused)[0]).toMatch(/^\d+ of \d+ possible faults left out: \d+ on setup, /)
  })

  it("keeps a decline and a 5xx ahead of a lost connection when it thins a write's faults", () => {
    const body = plan(bodyOf(realisticRun()))
    const focused = focusPlan(body, 0, { budget: 20 })
    const customers = focused.trials
      .filter((fault) => fault.label.endsWith("/v1/customers"))
      .map((fault) => fault.label)

    expect(customers).toEqual([
      "card_declined on POST api.stripe.com/v1/customers",
      "status 500 on POST api.stripe.com/v1/customers",
      "reset-after on POST api.stripe.com/v1/customers",
    ])
  })

  it("plans the same trials every time for the same clean run", () => {
    const once = focusPlan(plan(bodyOf(realisticRun())), 0, { budget: 15 })
    const again = focusPlan(plan(bodyOf(realisticRun())), 0, { budget: 15 })

    expect(again.trials.map((fault) => fault.label)).toEqual(
      once.trials.map((fault) => fault.label),
    )
  })

  it("keeps everything with all, every kind with thorough and every repeat with everyOccurrence", () => {
    const body = plan(bodyOf(realisticRun()))

    expect(focusPlan(body, 0, { all: true }).trials).toHaveLength(body.length)

    const thorough = focusPlan(body, 0, { budget: 1000, thorough: true, everyOccurrence: true })

    expect(thorough.skipped.kinds).toBe(0)
    expect(thorough.skipped.repeats).toBe(0)
  })
})

/** A 5xx planned on `route` with `method`. */
function onRoute(method: string, route: string): PlannedFault {
  return {
    target: "outbound",
    call: { method, host: "h", path: "/", index: 0 },
    route: `${method} ${route}`,
    occurrence: 0,
    fault: { kind: "status", status: 500 },
    label: route,
  }
}

describe("isBackground", () => {
  it("names health checks, token refreshes, assets and job-runner housekeeping", () => {
    expect(isBackground(onRoute("GET", "api.test/health"))).toBe(true)
    /* An app that cannot fetch signing keys must refuse tokens: those faults are the test's. */
    expect(isBackground(onRoute("GET", "clerk.test/.well-known/jwks.json"))).toBe(false)
    expect(isBackground(onRoute("POST", "clerk.test/v1/client/sessions/:id/tokens"))).toBe(true)
    expect(isBackground(onRoute("GET", "app.test/assets/main.js"))).toBe(true)
    expect(isBackground(onRoute("PUT", "worker.test/api/inngest"))).toBe(true)
    expect(isBackground(onRoute("POST", "api.stripe.com/v1/customers"))).toBe(false)
    expect(isBackground(onRoute("POST", "inngest.test/e/:id"))).toBe(false)
  })
})
