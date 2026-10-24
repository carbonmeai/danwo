import type { Exchange, OutboundFault } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { planFaults, type RunOutcome } from "../src/fault-matrix.ts"

/** An exchange as the proxy logs it, passed through unless `fields` says otherwise. */
function exchange(
  index: number,
  fields: Partial<Exchange> & Pick<Exchange, "method" | "host" | "path">,
): Exchange {
  return {
    disposition: "passthrough",
    startedAt: new Date(index * 1000).toISOString(),
    id: `x${index}`,
    fault: null,
    status: 200,
    durationMs: 1,
    aborted: false,
    ...fields,
  }
}

/** A clean run that made `exchanges`, in order. */
function clean(exchanges: readonly Exchange[]): RunOutcome {
  return { fault: null, status: "passed", error: null, exchanges, deliveries: [], notes: [] }
}

const ONE_FAULT = (): OutboundFault[] => [{ kind: "status", status: 500 }]

describe("a single-page app's calls to its own API", () => {
  it("get faults like a provider call, while the page's loads and the server's own calls do not", () => {
    const page = { client: "browser" as const }
    const plan = planFaults(
      clean([
        exchange(0, { ...page, load: "document", method: "GET", host: "127.0.0.1", path: "/" }),
        exchange(1, {
          ...page,
          load: "script",
          asset: true,
          method: "GET",
          host: "127.0.0.1",
          path: "/assets/index.js",
        }),
        exchange(2, {
          ...page,
          load: "request",
          method: "GET",
          host: "127.0.0.1",
          path: "/api/session",
        }),
        exchange(3, {
          ...page,
          load: "request",
          method: "POST",
          host: "127.0.0.1",
          path: "/api/billing/checkout",
        }),
        exchange(4, {
          disposition: "routed",
          client: "server",
          method: "POST",
          host: "api.stripe.com",
          path: "/v1/checkout/sessions",
        }),
        exchange(5, { client: "server", method: "POST", host: "127.0.0.1", path: "/api/inngest" }),
        exchange(6, {
          ...page,
          load: "request",
          stream: true,
          method: "GET",
          host: "localhost",
          path: "/api/events",
        }),
        exchange(7, {
          ...page,
          load: "request",
          method: "GET",
          host: "cdn.example.com",
          path: "/flags.json",
        }),
        exchange(8, {
          ...page,
          load: "request",
          disposition: "blocked",
          method: "GET",
          host: "127.0.0.1",
          path: "/api/blocked",
        }),
      ]),
      ONE_FAULT,
      [],
    )

    expect(plan.map((planned) => planned.label)).toEqual([
      "status 500 on GET 127.0.0.1/api/session",
      "status 500 on POST 127.0.0.1/api/billing/checkout",
      "status 500 on POST api.stripe.com/v1/checkout/sessions",
    ])
    expect(plan[1]).toMatchObject({
      target: "outbound",
      route: "POST 127.0.0.1/api/billing/checkout",
      occurrence: 0,
    })
  })
})
