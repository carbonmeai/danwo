/**
 * One Postgres connection through the proxy. Startup and authentication pass through untouched;
 * after the server's first ReadyForQuery, the client's messages are gathered into calls (a simple
 * Query, or extended-protocol messages up to a Sync), each classified and given its fault before
 * it is sent. Every call ends with exactly one ReadyForQuery from the server, so answers are
 * matched to calls in order, which also holds when a driver pipelines several.
 */
import type { CallHandle } from "../ledger.ts"
import { type ErrorFault, Line } from "../line.ts"
import type { Session, SessionContext, Wire } from "../tcp.ts"
import type { DataFault } from "../types.ts"
import {
  CANCEL_REQUEST,
  cStrings,
  errorFields,
  errorResponse,
  Framer,
  GSSENC_REQUEST,
  type PgMessage,
  query,
  readyForQuery,
  SSL_REQUEST,
} from "./frames.ts"
import { classify, operationOf } from "./sql.ts"

/** A gathered call once it is classified and its fault picked. */
interface Decided {
  readonly fault: DataFault | undefined
  readonly handle: CallHandle
  readonly verb: string
  readonly inTransaction: boolean
}

/** Client messages gathered into one call. */
interface Gathering {
  readonly messages: Buffer[]
  sql: string | undefined
  decided?: Decided
  /** Already being sent message by message (a driver flushed before its Sync). */
  streaming: boolean
}

/** Server messages that may come at any time and answer no call. */
const ASYNC = new Set(["A", "N", "S"])

/** Client messages that belong to a COPY already under way, sent straight on. */
const COPY = new Set(["d", "c", "f"])

export class PostgresSession implements Session {
  readonly #client = new Framer(false)
  readonly #server = new Framer(true)
  readonly #line: Line
  /** Prepared statements' text by name, for a Bind to a statement parsed in an earlier call. */
  readonly #statements = new Map<string, string>()
  #ready = false
  #status: "I" | "T" | "E" = "I"
  #gathering: Gathering | undefined

  constructor(wire: Wire, context: SessionContext) {
    this.#line = new Line(wire, context)
  }

  fromClient(bytes: Buffer): void {
    this.#client.feed(bytes)

    for (let message = this.#client.next(); message !== undefined; message = this.#client.next())
      this.#clientMessage(message)
  }

  fromServer(bytes: Buffer): void {
    this.#server.feed(bytes)

    for (let message = this.#server.next(); message !== undefined; message = this.#server.next())
      this.#serverMessage(message)
  }

  closed(): void {
    this.#gathering?.decided?.handle.dropped()
    this.#line.closed()
  }

  #clientMessage(message: PgMessage): void {
    if (!this.#client.typed) return this.#startupMessage(message)
    if (!this.#ready || COPY.has(message.type) || message.type === "X")
      return this.#line.send(message.raw)

    this.#gather(message)
  }

  /** The untyped messages a connection starts with: TLS is declined, the startup is passed on. */
  #startupMessage(message: PgMessage): void {
    const code = message.body.length >= 4 ? message.body.readInt32BE(0) : 0

    if (code === SSL_REQUEST || code === GSSENC_REQUEST)
      return this.#line.wire.toClient(Buffer.from("N"))
    if (code !== CANCEL_REQUEST) this.#client.typed = true

    this.#line.send(message.raw)
  }

  #gather(message: PgMessage): void {
    const gathering = (this.#gathering ??= { messages: [], sql: undefined, streaming: false })

    this.#readStatement(gathering, message)
    if (gathering.streaming) this.#line.send(message.raw)
    else gathering.messages.push(message.raw)

    if (message.type === "Q" || message.type === "S") return this.#finish(gathering)
    if (message.type === "H") this.#flush(gathering)
  }

  /** Notes the SQL a Query or Parse carries, and the statement a Bind runs. */
  #readStatement(gathering: Gathering, message: PgMessage): void {
    if (message.type === "Q") gathering.sql ??= cStrings(message.body, 1)[0]

    if (message.type === "P") {
      const [name = "", sql = ""] = cStrings(message.body, 2)

      this.#statements.set(name, sql)
      gathering.sql ??= sql
    }

    if (message.type === "B")
      gathering.sql ??= this.#statements.get(cStrings(message.body, 2)[1] ?? "")
  }

  /** Classifies the gathered call and picks its fault, once. */
  #decide(gathering: Gathering): Decided {
    if (gathering.decided !== undefined) return gathering.decided

    const statement = classify(gathering.sql ?? "")
    const inTransaction = this.#status !== "I"
    const { fault, handle } = this.#line.context.begin({
      operation: operationOf(statement),
      verb: statement.verb,
      role: statement.role,
      inTransaction,
    })

    gathering.decided = { fault, handle, verb: statement.verb, inTransaction }

    return gathering.decided
  }

  /** A Flush before the Sync: a call without a fault is sent on now, the rest as it comes. */
  #flush(gathering: Gathering): void {
    if (gathering.streaming || this.#decide(gathering).fault !== undefined) return

    gathering.streaming = true
    for (const bytes of gathering.messages.splice(0)) this.#line.send(bytes)
  }

  /** The call is complete (a Query, or a Sync): it is sent, held, answered or dropped. */
  #finish(gathering: Gathering): void {
    this.#gathering = undefined

    const decided = this.#decide(gathering)

    this.#line.dispatch(Buffer.concat(gathering.messages), decided.fault, decided.handle, (fault) =>
      this.#answerWithError(decided, fault),
    )
  }

  /**
   * The server is not asked to run the call; the client gets the error and a ReadyForQuery.
   * Inside a transaction the server's transaction is failed with the same error behind the
   * client's back, so later statements meet `25P02` as they would; a failed COMMIT rolls it back.
   */
  #answerWithError(decided: Decided, fault: ErrorFault): void {
    const commit = decided.inTransaction && decided.verb === "COMMIT"
    const status = decided.inTransaction && !commit ? "E" : "I"

    if (commit) this.#line.hide(query("ROLLBACK"))
    else if (decided.inTransaction) this.#line.hide(query(raising(fault.code)))

    this.#line.answer(
      Buffer.concat([
        errorResponse("ERROR", fault.code, fault.message ?? `injected ${fault.code}`),
        readyForQuery(status),
      ]),
    )
  }

  #serverMessage(message: PgMessage): void {
    if (!this.#ready) return this.#startupReply(message)

    const head = this.#line.head()

    if (ASYNC.has(message.type) || head === undefined) return this.#line.wire.toClient(message.raw)

    if (head === "call") this.#line.wire.toClient(message.raw)
    if (message.type === "E") this.#line.failHead(errorFields(message.body).get("C"))
    if (message.type !== "Z") return

    this.#status = statusOf(message)
    this.#line.settle()
  }

  /** The server's side of startup and authentication, passed on until it is ready for queries. */
  #startupReply(message: PgMessage): void {
    if (message.type === "Z") {
      this.#ready = true
      this.#status = statusOf(message)
    }

    this.#line.wire.toClient(message.raw)
  }
}

/** A statement that fails with SQLSTATE `code`, to leave the server's transaction failed. */
function raising(code: string): string {
  const sqlstate = /^[0-9A-Z]{5}$/.test(code) ? code : "40001"

  return `DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlstate}', MESSAGE = 'injected by danwo'; END $$`
}

/** The transaction status a ReadyForQuery reports. */
function statusOf(message: PgMessage): "I" | "T" | "E" {
  const status = String.fromCharCode(message.body[0] ?? 73)

  return status === "T" || status === "E" ? status : "I"
}
