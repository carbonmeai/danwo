import { describe, expect, it } from "vitest"

import { pgError } from "../src/faults.ts"
import {
  errorFields,
  errorResponse,
  Framer,
  type PgMessage,
  query,
  readyForQuery,
  SSL_REQUEST,
} from "../src/postgres/frames.ts"
import { PostgresSession } from "../src/postgres/session.ts"
import { harness, settle } from "./sessions.ts"

/** A typed message, as either end writes one. */
function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5)

  head.write(type, 0, "latin1")
  head.writeInt32BE(body.length + 4, 1)

  return Buffer.concat([head, body])
}

/** An untyped startup-phase message: length, then the body. */
function untyped(body: Buffer): Buffer {
  const head = Buffer.alloc(4)

  head.writeInt32BE(body.length + 4)

  return Buffer.concat([head, body])
}

const int32 = (value: number) => {
  const bytes = Buffer.alloc(4)

  bytes.writeInt32BE(value)

  return bytes
}

const sslRequest = untyped(int32(SSL_REQUEST))
const startup = untyped(
  Buffer.concat([int32(196_608), Buffer.from("user\0app\0database\0shop\0\0")]),
)
const authOk = message("R", int32(0))
const complete = (tag: string) => message("C", Buffer.from(`${tag}\0`))

/** Parse, Bind, Execute and Sync for one statement, as a driver's extended protocol sends them. */
function extended(sql: string, name = ""): Buffer {
  return Buffer.concat([
    message("P", Buffer.from(`${name}\0${sql}\0\0\0`)),
    message("B", Buffer.from(`\0${name}\0\0\0\0\0\0\0`)),
    message("E", Buffer.from("\0\0\0\0\0")),
    message("S"),
  ])
}

/** A session past startup: the server said ReadyForQuery idle. */
async function connected() {
  const h = harness("postgres", (wire, context) => new PostgresSession(wire, context))

  h.session.fromClient(sslRequest)
  h.session.fromClient(startup)
  h.session.fromServer(Buffer.concat([authOk, readyForQuery("I")]))
  await settle()

  return h
}

/** Every whole message in `chunks`, typed. */
function messages(chunks: readonly Buffer[]): PgMessage[] {
  const framer = new Framer(true)
  const out: PgMessage[] = []

  framer.feed(Buffer.concat(chunks))
  for (let next = framer.next(); next !== undefined; next = framer.next()) out.push(next)

  return out
}

describe("Framer", () => {
  it("cuts messages split across chunks and switches from untyped to typed", () => {
    const framer = new Framer(false)
    const stream = Buffer.concat([startup, query("SELECT 1")])

    framer.feed(stream.subarray(0, 7))
    expect(framer.next()).toBeUndefined()
    framer.feed(stream.subarray(7, startup.length + 3))

    const first = framer.next()

    expect(first?.type).toBe("")
    expect(first?.raw.equals(startup)).toBe(true)
    framer.typed = true
    expect(framer.next()).toBeUndefined()
    framer.feed(stream.subarray(startup.length + 3))
    expect(framer.next()?.type).toBe("Q")
  })

  it("reads an ErrorResponse's fields", () => {
    const [error] = messages([errorResponse("ERROR", "40001", "could not serialize")])

    expect(errorFields(error?.body ?? Buffer.alloc(0)).get("C")).toBe("40001")
  })
})

describe("PostgresSession", () => {
  it("declines TLS and passes startup through untouched", async () => {
    const h = await connected()

    expect(h.toClient[0]?.toString()).toBe("N")
    expect(Buffer.concat(h.toServer).equals(startup)).toBe(true)
    expect(h.ledger.calls()).toEqual([])
  })

  it("records simple and extended calls, with transaction state and pipelining", async () => {
    const h = await connected()

    h.session.fromClient(query("BEGIN"))
    h.session.fromServer(Buffer.concat([complete("BEGIN"), readyForQuery("T")]))
    h.session.fromClient(
      Buffer.concat([
        extended("UPDATE accounts SET balance = balance - $1 WHERE id = $2", "debit"),
        extended("INSERT INTO ledger (account, amount) VALUES ($1, $2)"),
      ]),
    )
    h.session.fromServer(Buffer.concat([complete("UPDATE 1"), readyForQuery("T")]))
    h.session.fromServer(Buffer.concat([complete("INSERT 0 1"), readyForQuery("T")]))
    h.session.fromClient(query("COMMIT"))
    h.session.fromServer(Buffer.concat([complete("COMMIT"), readyForQuery("I")]))
    await settle()

    expect(
      h.ledger.calls().map((call) => [call.operation, call.role, call.inTransaction, call.outcome]),
    ).toEqual([
      ["BEGIN", "boundary", false, "ok"],
      ["UPDATE accounts", "write", true, "ok"],
      ["INSERT ledger", "write", true, "ok"],
      ["COMMIT", "boundary", true, "ok"],
    ])
  })

  it("names a Bind to a statement parsed in an earlier call", async () => {
    const h = await connected()

    h.session.fromClient(
      Buffer.concat([
        message("P", Buffer.from("find\0SELECT * FROM orders WHERE id = $1\0\0\0")),
        message("S"),
      ]),
    )
    h.session.fromServer(Buffer.concat([message("1"), readyForQuery("I")]))
    h.session.fromClient(
      Buffer.concat([
        message("B", Buffer.from("\0find\0\0\0\0\0\0\0")),
        message("E", Buffer.from("\0\0\0\0\0")),
        message("S"),
      ]),
    )

    expect(h.ledger.calls().map((call) => call.operation)).toEqual([
      "SELECT orders",
      "SELECT orders",
    ])
  })

  it("answers an injected error itself, failing the server's transaction to match", async () => {
    const h = await connected()

    h.rule = (call) => (call.verb === "UPDATE" ? pgError("serialization_failure") : undefined)
    h.session.fromClient(query("BEGIN"))
    h.session.fromServer(Buffer.concat([complete("BEGIN"), readyForQuery("T")]))
    await settle()

    const sent = h.toServer.length

    h.session.fromClient(extended("UPDATE orders SET status = 'paid' WHERE id = $1"))
    await settle()

    const hidden = messages(h.toServer.slice(sent))

    expect(hidden.map((m) => m.type)).toEqual(["Q"])
    expect(hidden[0]?.body.toString()).toContain("ERRCODE = '40001'")

    const clientBytes = h.toClient.length

    h.session.fromServer(
      Buffer.concat([errorResponse("ERROR", "40001", "injected"), readyForQuery("E")]),
    )

    const reply = messages(h.toClient.slice(clientBytes))

    expect(reply.map((m) => m.type)).toEqual(["E", "Z"])
    expect(errorFields(reply[0]?.body ?? Buffer.alloc(0)).get("C")).toBe("40001")
    expect(reply[1]?.body.toString()).toBe("E")
    expect(h.ledger.calls()[1]).toMatchObject({
      operation: "UPDATE orders",
      outcome: "error",
      error: "40001",
      fault: "serialization_failure on UPDATE orders (postgres)",
    })
  })

  it("rolls the transaction back behind an injected COMMIT error", async () => {
    const h = await connected()

    h.rule = (call) => (call.verb === "COMMIT" ? pgError("serialization_failure") : undefined)
    h.session.fromClient(query("BEGIN"))
    h.session.fromServer(Buffer.concat([complete("BEGIN"), readyForQuery("T")]))
    h.session.fromClient(query("COMMIT"))
    await settle()

    expect(messages(h.toServer.slice(-1))[0]?.body.toString()).toBe("ROLLBACK\0")

    const clientBytes = h.toClient.length

    h.session.fromServer(Buffer.concat([complete("ROLLBACK"), readyForQuery("I")]))

    const reply = messages(h.toClient.slice(clientBytes))

    expect(reply.map((m) => m.type)).toEqual(["E", "Z"])
    expect(reply[1]?.body.toString()).toBe("I")
    expect(h.ledger.calls()).toHaveLength(2)
  })

  it("queues an injected answer behind the calls before it", async () => {
    const h = await connected()

    h.rule = (call) => (call.verb === "INSERT" ? pgError("deadlock_detected") : undefined)
    h.session.fromClient(
      Buffer.concat([extended("SELECT * FROM orders"), extended("INSERT INTO orders VALUES (1)")]),
    )
    expect(h.toClient.length).toBe(3)
    h.session.fromServer(Buffer.concat([complete("SELECT 0"), readyForQuery("I")]))

    const reply = messages(h.toClient.slice(3)).map((m) => m.type)

    expect(reply).toEqual(["C", "Z", "E", "Z"])
  })

  it("runs a call then drops the line before the app sees the answer (reset-after)", async () => {
    const h = await connected()

    h.rule = (call) => (call.verb === "COMMIT" ? { kind: "reset-after" } : undefined)
    h.session.fromClient(query("BEGIN"))
    h.session.fromServer(Buffer.concat([complete("BEGIN"), readyForQuery("T")]))
    h.session.fromClient(query("COMMIT"))
    await settle()

    expect(messages(h.toServer.slice(-1))[0]?.body.toString()).toBe("COMMIT\0")

    const clientBytes = h.toClient.length

    h.session.fromServer(complete("COMMIT"))
    expect(h.killed).toBe(false)
    h.session.fromServer(readyForQuery("I"))
    expect(h.killed).toBe(true)
    expect(h.toClient.length).toBe(clientBytes)
    expect(h.ledger.calls()[1]).toMatchObject({
      outcome: "reset",
      fault: "reset-after on COMMIT (postgres)",
    })
  })

  it("drops the line before the call is sent (reset) and takes the server down (down)", async () => {
    const h = await connected()

    h.rule = () => ({ kind: "down", ms: 3000 })

    const sent = h.toServer.length

    h.session.fromClient(query("BEGIN"))
    await settle()

    expect(h.toServer.length).toBe(sent)
    expect(h.killed).toBe(true)
    expect(h.downs).toEqual([{ kind: "down", ms: 3000 }])
    expect(h.ledger.calls()[0]).toMatchObject({
      outcome: "reset",
      fault: "down 3000ms on BEGIN (postgres)",
    })
  })

  it("holds a delayed call and the ones behind it", async () => {
    const h = await connected()

    h.rule = (call) => (call.verb === "UPDATE" ? { kind: "delay", ms: 40 } : undefined)

    const sent = h.toServer.length

    h.session.fromClient(query("UPDATE orders SET x = 1"))
    h.session.fromClient(query("SELECT * FROM orders"))
    await settle()
    expect(h.toServer.length).toBe(sent)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(h.toServer.length).toBe(sent + 2)
  })

  it("passes notices and notifications through without settling a call", async () => {
    const h = await connected()

    h.session.fromClient(query("SELECT * FROM orders"))
    h.session.fromServer(message("N", Buffer.from("SNOTICE\0\0")))
    expect(h.ledger.calls()[0]?.outcome).toBe("pending")
    h.session.fromServer(Buffer.concat([complete("SELECT 0"), readyForQuery("I")]))
    expect(h.ledger.calls()[0]?.outcome).toBe("ok")
  })
})
