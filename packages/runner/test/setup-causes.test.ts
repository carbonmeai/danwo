import type { DataCall } from "@danwo/infra"
import type { ServiceDelivery, SetupSpan } from "@danwo/matrix"
import { describe, expect, it } from "vitest"

import { type RunLists, setupCaused } from "../src/runner/setup-causes.ts"

const at = (ms: number): string => new Date(ms).toISOString()

function delivery(messageId: number, sentAt: number, durationMs = 50): ServiceDelivery {
  return {
    messageId,
    topic: "customer.created",
    endpointId: "we_1",
    attempt: 1,
    at: at(sentAt),
    sentAt: at(sentAt),
    status: 200,
    error: null,
    durationMs,
    delivered: true,
    fault: null,
  }
}

function call(verb: string, startedAt: number, inTransaction = false, connection = 1): DataCall {
  return {
    service: "postgres",
    kind: "postgres",
    operation: `${verb} users`,
    verb,
    role: verb === "SELECT" ? "read" : "write",
    inTransaction,
    connection,
    startedAt: at(startedAt),
    durationMs: 1,
    outcome: "ok",
    fault: null,
  }
}

const span = (more: Partial<SetupSpan> = {}): SetupSpan => ({
  exchanges: 1,
  deliveries: 0,
  sockets: 0,
  data: { postgres: 0 },
  ...more,
})

describe("setupCaused", () => {
  it("names deliveries of messages emitted before the body, and what the app did answering them", () => {
    const run: RunLists = {
      exchanges: [
        { startedAt: at(100), client: "server" },
        { startedAt: at(1010), client: "server" },
        { startedAt: at(1020), client: "browser" },
        { startedAt: at(2010), client: "server" },
      ],
      deliveries: [delivery(1, 1000), delivery(2, 2000)],
      dataCalls: [call("INSERT", 1030), call("INSERT", 2030)],
    }

    expect(setupCaused(run, span(), { "": 1 })).toEqual({
      exchanges: [1],
      deliveries: [0],
      data: [0],
      sockets: [],
    })
  })

  it("keeps a service's own message marks apart", () => {
    const run: RunLists = {
      exchanges: [],
      deliveries: [
        { ...delivery(3, 1000), service: "stripe" },
        { ...delivery(3, 1100), service: "clerk" },
      ],
      dataCalls: [],
    }

    expect(setupCaused(run, span({ exchanges: 0 }), { stripe: 3, clerk: 2 }).deliveries).toEqual([
      0,
    ])
  })

  it("follows a transaction setup opened until it ends, and no further", () => {
    const run: RunLists = {
      exchanges: [],
      deliveries: [],
      dataCalls: [
        call("BEGIN", 10, true),
        call("INSERT", 20, true),
        call("UPDATE", 30, true),
        call("COMMIT", 40, true),
        call("INSERT", 50),
        call("SELECT", 60, false, 2),
      ],
    }

    expect(setupCaused(run, span({ exchanges: 0, data: { postgres: 2 } }), {}).data).toEqual([2, 3])
  })

  it("names nothing when setup set nothing off", () => {
    const run: RunLists = {
      exchanges: [{ startedAt: at(10), client: "server" }],
      deliveries: [delivery(1, 5)],
      dataCalls: [call("INSERT", 20)],
    }

    expect(setupCaused(run, span({ exchanges: 0, deliveries: 1 }), { "": 1 })).toEqual({
      exchanges: [],
      deliveries: [],
      data: [],
      sockets: [],
    })
  })
})
