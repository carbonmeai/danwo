import type { Proxy, SocketExchange, SocketFaultRule } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { applyFault, checkFaultFired, planFaults, type RunOutcome } from "../src/fault-matrix.ts"
import { socketRoute } from "../src/socket-faults.ts"

function socket(overrides: Partial<SocketExchange>): SocketExchange {
  return {
    id: "s1",
    disposition: "passthrough",
    host: "127.0.0.1",
    path: "/live",
    startedAt: new Date(0).toISOString(),
    client: "browser",
    fault: null,
    status: 101,
    closedAt: null,
    closeCode: null,
    aborted: false,
    fromClient: { frames: 0, bytes: 0 },
    toClient: { frames: 0, bytes: 0 },
    ...overrides,
  }
}

function outcome(
  sockets: readonly SocketExchange[],
  fault: RunOutcome["fault"] = null,
): RunOutcome {
  return { fault, status: "passed", error: null, exchanges: [], deliveries: [], sockets, notes: [] }
}

describe("socket faults", () => {
  it("plans a refused upgrade and a dropped connection on every socket the clean run opened", () => {
    const plan = planFaults(
      outcome([
        socket({ path: "/app/8f2c3a91b7d64e0f?protocol=7" }),
        socket({ id: "s2", path: "/app/1d2e3f4a5b6c7d8e" }),
        socket({ id: "s3", host: "ws.blocked.test", disposition: "blocked", status: 403 }),
      ]),
      () => [],
      [],
    )

    expect(plan.map((p) => p.label)).toEqual([
      "upgrade refused on WS 127.0.0.1/app/:id",
      "connection dropped on WS 127.0.0.1/app/:id",
      "upgrade refused on WS 127.0.0.1/app/:id #2",
      "connection dropped on WS 127.0.0.1/app/:id #2",
    ])
  })

  it("arms the fault on its socket only, and judges a run whose socket never opened invalid", () => {
    let rule: SocketFaultRule | undefined
    const proxy = { setSocketFault: (next: SocketFaultRule | undefined) => (rule = next) }
    const [planned] = planFaults(outcome([socket({})]), () => [], [])

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- applyFault only arms sockets here
    const fake = proxy as unknown as Proxy

    applyFault({ proxy: fake, webhooks: undefined, data: undefined }, planned ?? null)

    expect(rule?.({ host: "127.0.0.1", path: "/other", index: 0 })).toBeUndefined()
    expect(rule?.({ host: "127.0.0.1", path: "/live", index: 1 })).toEqual({ kind: "refuse" })
    expect(rule?.({ host: "127.0.0.1", path: "/live", index: 2 })).toBeUndefined()

    expect(checkFaultFired(outcome([], planned ?? null)).status).toBe("invalid")
    expect(checkFaultFired(outcome([socket({ fault: "ws refuse" })], planned ?? null)).status).toBe(
      "passed",
    )
  })

  it("folds generated ids out of a socket's route", () => {
    expect(socketRoute({ host: "ws-eu.pusher.com", path: "/app/123456?client=js" })).toBe(
      "WS ws-eu.pusher.com/app/:id",
    )
  })
})
