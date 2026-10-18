import { describe, expect, it } from "vitest"

import { redisError } from "../src/faults.ts"
import { RespReader, type RespValue } from "../src/redis/resp.ts"
import { RedisSession } from "../src/redis/session.ts"
import { harness, settle } from "./sessions.ts"

/** A command as a client library writes it: an array of bulk strings. */
function command(...words: string[]): Buffer {
  return Buffer.from(
    `*${words.length}\r\n${words.map((word) => `$${Buffer.byteLength(word)}\r\n${word}\r\n`).join("")}`,
  )
}

function values(reader: RespReader, bytes: Buffer): RespValue[] {
  const out: RespValue[] = []

  reader.feed(bytes)
  for (let next = reader.next(); next !== undefined; next = reader.next()) out.push(next)

  return out
}

describe("RespReader", () => {
  it("reads commands, inline commands, and a command split across chunks", () => {
    const reader = new RespReader(true)
    const set = command("SET", "rate:1", "hello world")

    expect(values(reader, set.subarray(0, 10))).toEqual([])
    expect(
      values(reader, Buffer.concat([set.subarray(10), Buffer.from("PING\r\n")])).map(
        (v) => v.words,
      ),
    ).toEqual([["SET", "rate:1", "hello world"], ["PING"]])
  })

  it("reads RESP2 and RESP3 replies whole, nested ones included", () => {
    const reader = new RespReader(false)
    const replies = [
      "+OK\r\n",
      "-OOM command not allowed\r\n",
      ":42\r\n",
      "$5\r\nhello\r\n",
      "$-1\r\n",
      "*2\r\n$1\r\na\r\n*1\r\n:1\r\n",
      "%1\r\n+key\r\n#t\r\n",
      "|1\r\n+ttl\r\n:3\r\n,1.5\r\n",
      ">3\r\n$7\r\nmessage\r\n$4\r\nnews\r\n$2\r\nhi\r\n",
      "_\r\n",
    ]
    const read = values(reader, Buffer.from(replies.join("")))

    expect(read.map((value) => value.raw.toString())).toEqual(replies)
    expect(read[1]?.error).toBe("OOM command not allowed")
  })

  it("waits for the rest of a bulk string", () => {
    const reader = new RespReader(false)

    expect(values(reader, Buffer.from("$5\r\nhel"))).toEqual([])
    expect(values(reader, Buffer.from("lo\r\n"))[0]?.raw.toString()).toBe("$5\r\nhello\r\n")
  })
})

function connected() {
  return harness("redis", (wire, context) => new RedisSession(wire, context))
}

describe("RedisSession", () => {
  it("matches pipelined replies to commands and tracks MULTI/EXEC", async () => {
    const h = connected()

    h.session.fromClient(
      Buffer.concat([
        command("MULTI"),
        command("INCR", "rate:42"),
        command("EXPIRE", "rate:42", "60"),
        command("EXEC"),
        command("GET", "rate:42"),
      ]),
    )
    h.session.fromServer(Buffer.from("+OK\r\n+QUEUED\r\n+QUEUED\r\n*2\r\n:1\r\n:1\r\n$1\r\n1\r\n"))
    await settle()

    expect(
      h.ledger.calls().map((call) => [call.operation, call.role, call.inTransaction, call.outcome]),
    ).toEqual([
      ["MULTI", "other", false, "ok"],
      ["INCR rate:*", "write", true, "ok"],
      ["EXPIRE rate:*", "write", true, "ok"],
      ["EXEC", "boundary", true, "ok"],
      ["GET rate:*", "read", false, "ok"],
    ])
    expect(Buffer.concat(h.toClient).toString()).toContain("*2\r\n:1\r\n:1\r\n")
  })

  it("answers an injected error in line, behind the replies before it", async () => {
    const h = connected()

    h.rule = (call) => (call.verb === "SET" ? redisError("OOM") : undefined)
    h.session.fromClient(Buffer.concat([command("GET", "a"), command("SET", "a", "1")]))
    await settle()

    expect(h.toServer.map(String)).toEqual([command("GET", "a").toString()])
    expect(h.toClient).toEqual([])
    h.session.fromServer(Buffer.from("$-1\r\n"))
    expect(h.toClient.map(String)).toEqual([
      "$-1\r\n",
      "-OOM command not allowed when used memory > 'maxmemory'.\r\n",
    ])
    expect(h.ledger.calls()[1]).toMatchObject({
      outcome: "error",
      error: "OOM",
      fault: "OOM on SET a (redis)",
    })
  })

  it("records a server error reply by its prefix", () => {
    const h = connected()

    h.session.fromClient(command("INCR", "name"))
    h.session.fromServer(Buffer.from("-ERR value is not an integer or out of range\r\n"))
    expect(h.ledger.calls()[0]).toMatchObject({ outcome: "error", error: "ERR", fault: null })
  })

  it("runs a command then drops the line before the reply (reset-after)", async () => {
    const h = connected()

    h.rule = (call) => (call.verb === "INCR" ? { kind: "reset-after" } : undefined)
    h.session.fromClient(command("INCR", "rate:7"))
    await settle()
    expect(h.toServer).toHaveLength(1)
    h.session.fromServer(Buffer.from(":1\r\n"))
    expect(h.toClient).toEqual([])
    expect(h.killed).toBe(true)
    expect(h.ledger.calls()[0]).toMatchObject({
      outcome: "reset",
      fault: "reset-after on INCR rate:* (redis)",
    })
  })

  it("passes push messages through and a subscribed connection untouched", async () => {
    const h = connected()

    h.session.fromClient(command("GET", "a"))
    h.session.fromServer(Buffer.from(">2\r\n$10\r\ninvalidate\r\n*1\r\n$1\r\na\r\n"))
    expect(h.ledger.calls()[0]?.outcome).toBe("pending")
    h.session.fromServer(Buffer.from("$-1\r\n"))
    expect(h.ledger.calls()[0]?.outcome).toBe("ok")

    h.session.fromClient(command("SUBSCRIBE", "news"))
    h.session.fromClient(command("PING"))
    await settle()
    expect(h.ledger.calls()).toHaveLength(1)
    expect(h.toServer).toHaveLength(3)
  })
})
