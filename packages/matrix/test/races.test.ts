import type { Exchange } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { faultFired, type RunOutcome, type ServiceDelivery } from "../src/fault-matrix.ts"
import { planRaceFaults } from "../src/races.ts"

/** A routed call as the proxy logs it. */
function call(method: string, host: string, path: string, client: "browser" | "server"): Exchange {
  return {
    disposition: "routed",
    method,
    host,
    path,
    startedAt: new Date(0).toISOString(),
    id: `${method}${path}`,
    client,
    fault: null,
    status: 200,
    durationMs: 1,
    aborted: false,
  }
}

/** A delivered webhook, first attempt, to `endpointId`. */
function delivery(messageId: number, topic: string, endpointId = "we_1"): ServiceDelivery {
  return {
    messageId,
    topic,
    endpointId,
    attempt: 1,
    at: new Date(0).toISOString(),
    status: 200,
    error: null,
    durationMs: 1,
    delivered: true,
    fault: null,
  }
}

function clean(exchanges: Exchange[] = [], deliveries: ServiceDelivery[] = []): RunOutcome {
  return { fault: null, status: "passed", error: null, exchanges, deliveries, notes: [] }
}

const labels = (plan: ReturnType<typeof planRaceFaults>) => plan.map((fault) => fault.label)

describe("planRaceFaults", () => {
  it("plans a double-submit for each change-making app request, counting repeats", () => {
    const evidence = { submits: ["POST /cart", "POST /buy", "POST /buy"], returns: [] }
    const plan = planRaceFaults(clean(), { evidence })

    expect(labels(plan)).toEqual([
      "double-submit on POST /cart",
      "double-submit on POST /buy",
      "double-submit on POST /buy #2",
    ])
    expect(plan[2]).toMatchObject({ target: "page", route: "POST /buy", occurrence: 1 })
  })

  it("plans concurrent users only for a test that asks for at least two", () => {
    expect(labels(planRaceFaults(clean(), { users: 3 }))).toEqual(["3 concurrent users"])
    expect(planRaceFaults(clean(), { users: 1 })).toEqual([])
  })

  it("plans webhooks before a redirect only when the run delivered webhooks", () => {
    const evidence = {
      submits: [],
      returns: [
        { site: "checkout.stripe.com", via: "POST checkout.stripe.com/checkout/:id/complete" },
      ],
    }

    expect(planRaceFaults(clean(), { evidence })).toEqual([])

    const plan = planRaceFaults(clean([], [delivery(1, "checkout.session.completed")]), {
      evidence,
    })

    expect(plan).toEqual([
      {
        target: "redirect",
        occurrence: 0,
        via: { route: "POST checkout.stripe.com/checkout/:id/complete", occurrence: 0 },
        label: "webhooks before redirect from checkout.stripe.com",
      },
    ])
  })

  it("reorders two different webhooks one endpoint got in a row, and nothing else", () => {
    const deliveries = [
      delivery(1, "payment_intent.created"),
      delivery(2, "payment_intent.succeeded"),
      delivery(3, "payment_intent.succeeded", "we_other"),
      delivery(4, "charge.succeeded"),
    ]
    const plan = planRaceFaults(clean([], deliveries))

    expect(labels(plan)).toEqual([
      "reorder webhooks payment_intent.created, payment_intent.succeeded",
      "reorder webhooks payment_intent.succeeded, charge.succeeded",
    ])
    expect(plan[0]).toMatchObject({
      target: "webhook",
      topic: "payment_intent.created",
      occurrence: 0,
      fault: { kind: "after", topic: "payment_intent.succeeded" },
    })
    expect(planRaceFaults(clean([], [delivery(1, "a"), delivery(2, "a")]))).toEqual([])
  })

  it("does not reorder webhooks sent far apart, such as either side of a time jump", () => {
    const later = {
      ...delivery(2, "customer.subscription.updated"),
      at: new Date(15 * 86_400_000).toISOString(),
    }

    expect(
      planRaceFaults(clean([], [delivery(1, "customer.subscription.created"), later])),
    ).toEqual([])
  })

  it("holds only the calls slow-then-retry applies to", () => {
    const exchanges = [
      call("POST", "api.stripe.com", "/v1/checkout/sessions", "server"),
      call("POST", "checkout.stripe.com", "/checkout/cs_test_a1b2c3d4e5/complete", "browser"),
    ]
    const plan = planRaceFaults(clean(exchanges), {
      slowThenRetry: { ms: 3_000, applies: (c) => c.client === "server" },
    })

    expect(plan).toEqual([
      expect.objectContaining({
        target: "outbound",
        route: "POST api.stripe.com/v1/checkout/sessions",
        fault: { kind: "slow-then-retry", ms: 3_000 },
        label: "slow-then-retry 3000ms on POST api.stripe.com/v1/checkout/sessions",
      }),
    ])
  })

  it("plans no race that is turned off", () => {
    const evidence = { submits: ["POST /buy"], returns: [{ site: "pay.test" }] }
    const run = clean([], [delivery(1, "a"), delivery(2, "b")])

    expect(
      planRaceFaults(run, {
        evidence,
        doubleSubmit: false,
        beforeRedirect: false,
        webhookOrder: false,
      }),
    ).toEqual([])
  })
})

describe("a race fault firing", () => {
  it("counts as fired only when the run says its race was set up", () => {
    const fault = { target: "users" as const, users: 2, label: "2 concurrent users" }
    const outcome = { ...clean(), fault }

    expect(faultFired(outcome)).toBe(false)
    expect(faultFired({ ...outcome, fired: true })).toBe(true)
  })
})
