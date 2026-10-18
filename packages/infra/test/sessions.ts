/** A protocol session wired to recording fakes, to feed it byte streams by hand. */
import { describeDataFault } from "../src/faults.ts"
import { Ledger } from "../src/ledger.ts"
import type { Session, SessionContext, Wire } from "../src/tcp.ts"
import type { DataFault, DataFaultRule, DataKind } from "../src/types.ts"

export interface Harness<S extends Session> {
  readonly session: S
  readonly ledger: Ledger
  /** Bytes the session sent the server, and the client, in order. */
  readonly toServer: Buffer[]
  readonly toClient: Buffer[]
  readonly downs: Extract<DataFault, { kind: "down" }>[]
  killed: boolean
  rule: DataFaultRule | undefined
}

export function harness<S extends Session>(
  kind: DataKind,
  make: (wire: Wire, context: SessionContext) => S,
): Harness<S> {
  const ledger = new Ledger()
  const state = {
    toServer: [] as Buffer[],
    toClient: [] as Buffer[],
    downs: [] as Extract<DataFault, { kind: "down" }>[],
    killed: false,
    rule: undefined as DataFaultRule | undefined,
  }
  let session: S | undefined
  const wire: Wire = {
    toServer: (bytes) => void state.toServer.push(bytes),
    toClient: (bytes) => void state.toClient.push(bytes),
    kill: () => {
      if (state.killed) return
      state.killed = true
      session?.closed()
    },
  }
  const context: SessionContext = {
    connection: 1,
    service: kind,
    begin: (partial) => {
      const start = { ...partial, service: kind, kind, connection: 1 }
      const fault = state.rule?.(start)
      const label =
        fault === undefined ? null : `${describeDataFault(fault)} on ${start.operation} (${kind})`

      return { fault, handle: ledger.begin(start, fault, label) }
    },
    goDown: (fault) => void state.downs.push(fault),
  }

  session = make(wire, context)

  return Object.assign(state, { session, ledger })
}

/** Lets queued writes (the session sends through a promise chain) reach the fake wire. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 5))
