/**
 * What both protocols share once a call is framed: writes to the server in order (a delayed call
 * holds back the ones behind it), the queue of answers the client is owed, in order, and how a
 * call's fault decides whether it is sent, held, answered by the proxy or dropped.
 */
import type { CallHandle } from "./ledger.ts"
import type { SessionContext, Wire } from "./tcp.ts"
import type { DataFault } from "./types.ts"

/**
 * An answer the client is owed: a call's, from the server (held: run, but never shown to the
 * client); one the proxy sent the server behind the client's back, swallowed; or the proxy's own.
 */
type Pending =
  | {
      readonly kind: "call"
      readonly handle: CallHandle
      readonly hold: boolean
      code?: string | undefined
    }
  | { readonly kind: "hidden" }
  | { readonly kind: "answer"; readonly bytes: Buffer }

export type ErrorFault = Extract<DataFault, { kind: "error" }>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class Line {
  readonly wire: Wire
  readonly context: SessionContext
  readonly #pending: Pending[] = []
  #sending: Promise<unknown> = Promise.resolve()
  #dead = false

  constructor(wire: Wire, context: SessionContext) {
    this.wire = wire
    this.context = context
  }

  /** Writes to the server after the writes before, `delayMs` late. */
  send(bytes: Buffer, delayMs = 0): void {
    this.#sending = this.#sending.then(async () => {
      if (delayMs > 0) await sleep(delayMs)
      if (!this.#dead) this.wire.toServer(bytes)
    })
  }

  /**
   * Runs a framed call under its fault: sent (late, for a delay), sent with its answer held
   * (reset-after), answered by `answerError` without the server (error), or dropped (reset, down).
   */
  dispatch(
    bytes: Buffer,
    fault: DataFault | undefined,
    handle: CallHandle,
    answerError: (fault: ErrorFault) => void,
  ): void {
    if (fault === undefined || fault.kind === "delay" || fault.kind === "reset-after") {
      this.send(bytes, fault?.kind === "delay" ? fault.ms : 0)
      this.#pending.push({ kind: "call", handle, hold: fault?.kind === "reset-after" })

      return
    }

    if (fault.kind === "error") {
      handle.answered(fault.code)

      return answerError(fault)
    }

    handle.dropped()
    if (fault.kind === "down") this.context.goDown(fault)
    this.wire.kill()
  }

  /** The kind of answer the server's next reply belongs to, if it belongs to one. */
  head(): "call" | "hidden" | "held" | undefined {
    const head = this.#pending[0]

    if (head === undefined || head.kind === "answer") return undefined
    if (head.kind === "hidden") return "hidden"

    return head.hold ? "held" : "call"
  }

  /** Notes the error code the server answered the head call with, for its record. */
  failHead(code: string | undefined): void {
    const head = this.#pending[0]

    if (head?.kind === "call") head.code = code
  }

  /** Something the proxy sent the server, whose answer the client must not see. */
  hide(bytes: Buffer): void {
    this.send(bytes)
    this.#pending.push({ kind: "hidden" })
  }

  /** The proxy's own answer, sent once the answers before it are. */
  answer(bytes: Buffer): void {
    this.#pending.push({ kind: "answer", bytes })
    this.#flush()
  }

  /** The server's answer to the head has ended: it is settled, or, held, the line is dropped. */
  settle(): void {
    const head = this.#pending.shift()

    if (head?.kind === "call" && head.hold) {
      head.handle.dropped()
      this.wire.kill()

      return
    }

    if (head?.kind === "call") head.handle.answered(head.code)
    this.#flush()
  }

  /** The connection is gone: calls still owed an answer never got one. */
  closed(): void {
    this.#dead = true
    for (const pending of this.#pending) if (pending.kind === "call") pending.handle.dropped()
  }

  #flush(): void {
    for (let next = this.#pending[0]; next?.kind === "answer"; next = this.#pending[0]) {
      this.#pending.shift()
      this.wire.toClient(next.bytes)
    }
  }
}
