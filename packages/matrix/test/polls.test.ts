import type { WebhookFault } from "@danwo/emulators"
import type { Exchange, OutboundFault } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { planFaults, pollPositions, type RunOutcome } from "../src/fault-matrix.ts"

/** A routed call as the proxy logs it. */
function call(method: string, host: string, path: string, index: number): Exchange {
  return {
    disposition: "routed",
    method,
    host,
    path,
    startedAt: new Date(index * 1000).toISOString(),
    id: `x${index}`,
    fault: null,
    status: 200,
    durationMs: 1,
    aborted: false,
  }
}

/** A clean run that made `calls`, in order. */
function clean(calls: readonly (readonly [string, string, string])[]): RunOutcome {
  return {
    fault: null,
    status: "passed",
    error: null,
    exchanges: calls.map(([method, host, path], index) => call(method, host, path, index)),
    deliveries: [],
    notes: [],
  }
}

const ONE_FAULT = (): OutboundFault[] => [{ kind: "status", status: 500 }]
const NO_WEBHOOK_FAULTS: readonly WebhookFault[] = []

describe("polls in a fault plan", () => {
  it("finds a read repeated back to back, whatever its query", () => {
    expect(
      pollPositions([
        { method: "GET", host: "shop.test", path: "/credits?user=u1" },
        { method: "POST", host: "shop.test", path: "/checkout" },
        { method: "GET", host: "shop.test", path: "/credits?user=u1" },
        { method: "GET", host: "shop.test", path: "/credits?user=u1&t=2" },
        { method: "HEAD", host: "shop.test", path: "/credits" },
        { method: "GET", host: "shop.test", path: "/orders/1" },
        { method: "GET", host: "shop.test", path: "/orders/2" },
        { method: "POST", host: "shop.test", path: "/checkout" },
        { method: "POST", host: "shop.test", path: "/checkout" },
      ]),
    ).toEqual(["none", "none", "first", "repeat", "none", "first", "repeat", "none", "none"])
  })

  it("plans a poll's faults on its first call only, and names it a poll", () => {
    const plan = planFaults(
      clean([
        ["GET", "shop.danwo.test", "/credits?user=u1"],
        ["POST", "shop.danwo.test", "/checkout?user=u1"],
        ["POST", "api.stripe.com", "/v1/checkout/sessions"],
        ["GET", "shop.danwo.test", "/credits?user=u1"],
        ["GET", "shop.danwo.test", "/credits?user=u1"],
        ["GET", "shop.danwo.test", "/credits?user=u1"],
        ["GET", "shop.danwo.test", "/credits?user=u1"],
      ]),
      ONE_FAULT,
      NO_WEBHOOK_FAULTS,
    )

    expect(plan.map((planned) => planned.label)).toEqual([
      "status 500 on GET shop.danwo.test/credits",
      "status 500 on POST shop.danwo.test/checkout",
      "status 500 on POST api.stripe.com/v1/checkout/sessions",
      "status 500 on GET shop.danwo.test/credits #2 (poll)",
    ])
    expect(plan.at(-1)).toMatchObject({ target: "outbound", occurrence: 1 })
  })

  it("keeps a fault on every repeated write: repeating one is no poll", () => {
    const plan = planFaults(
      clean([
        ["POST", "api.stripe.com", "/v1/refunds"],
        ["POST", "api.stripe.com", "/v1/refunds"],
      ]),
      ONE_FAULT,
      NO_WEBHOOK_FAULTS,
    )

    expect(plan.map((planned) => planned.label)).toEqual([
      "status 500 on POST api.stripe.com/v1/refunds",
      "status 500 on POST api.stripe.com/v1/refunds #2",
    ])
  })
})
