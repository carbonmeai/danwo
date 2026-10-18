import { describe, expect, it } from "vitest"

import { describeDataFault, pgError, redisError } from "../src/faults.ts"
import { classify, operationOf } from "../src/postgres/sql.ts"
import { classifyCommand, foldKey } from "../src/redis/commands.ts"

describe("classify (SQL)", () => {
  it.each([
    ["BEGIN", "BEGIN", "boundary"],
    ["start transaction isolation level serializable", "BEGIN", "boundary"],
    ["COMMIT", "COMMIT", "boundary"],
    ["end", "COMMIT", "boundary"],
    ["ROLLBACK", "ROLLBACK", "boundary"],
    ["SAVEPOINT s1", "SAVEPOINT", "boundary"],
    ["INSERT INTO orders (id) VALUES ($1)", "INSERT orders", "write"],
    ['insert into public."Orders" values (1)', "INSERT orders", "write"],
    ["UPDATE ONLY accounts SET balance = balance - $1", "UPDATE accounts", "write"],
    ["DELETE FROM sessions WHERE id = $1", "DELETE sessions", "write"],
    ["MERGE INTO stock USING x ON true WHEN MATCHED THEN DELETE", "MERGE stock", "write"],
    [
      "WITH moved AS (UPDATE ledger SET x = 1 RETURNING *) SELECT * FROM moved",
      "UPDATE ledger",
      "write",
    ],
    ["WITH t AS (SELECT 1) SELECT * FROM orders", "SELECT orders", "read"],
    ["/* hi */ -- note\n  (SELECT id FROM orders WHERE id = 1)", "SELECT orders", "read"],
    ["SELECT 1", "SELECT", "other"],
    ["SET search_path TO public", "SET", "other"],
    ["", "UNKNOWN", "other"],
  ])("reads %j as %s (%s)", (sql, operation, role) => {
    const statement = classify(sql)

    expect(operationOf(statement)).toBe(operation)
    expect(statement.role).toBe(role)
  })
})

describe("classifyCommand (Redis)", () => {
  it.each([
    [["GET", "session:abc"], "GET session:abc", "read"],
    [["set", "coupon:WELCOME:user:42", "1", "NX"], "SET coupon:WELCOME:user:*", "write"],
    [["INCR", "rate:203.0.113.9"], "INCR rate:*", "write"],
    [["EXPIRE", "rate:u-1", "60"], "EXPIRE rate:*", "write"],
    [["EXEC"], "EXEC", "boundary"],
    [["MULTI"], "MULTI", "other"],
    [["PUBLISH", "news", "hi"], "PUBLISH", "write"],
    [["PING"], "PING", "other"],
    [["HELLO", "3"], "HELLO", "other"],
    [["SUBSCRIBE", "news"], "SUBSCRIBE news", "other"],
  ])("reads %j as %s (%s)", (words, operation, role) => {
    const command = classifyCommand(words)

    expect(command.operation).toBe(operation)
    expect(command.role).toBe(role)
  })

  it("folds segments that name one record", () => {
    expect(foldKey("cart:6f1c2a9e-1b2c-4d5e-8f90-123456789abc:items")).toBe("cart:*:items")
    expect(foldKey("token:AbCdEfGhIjKlMnOpQr")).toBe("token:*")
    expect(foldKey("config:flags")).toBe("config:flags")
  })
})

describe("describeDataFault", () => {
  it("names each fault in a few words", () => {
    expect(describeDataFault({ kind: "reset" })).toBe("reset")
    expect(describeDataFault({ kind: "reset-after" })).toBe("reset-after")
    expect(describeDataFault({ kind: "delay", ms: 5000 })).toBe("delay 5000ms")
    expect(describeDataFault(pgError("serialization_failure"))).toBe("serialization_failure")
    expect(describeDataFault(pgError("deadlock_detected"))).toBe("deadlock_detected")
    expect(describeDataFault(redisError("OOM"))).toBe("OOM")
    expect(describeDataFault({ kind: "down", ms: 3000 })).toBe("down 3000ms")
    expect(describeDataFault({ kind: "down", ms: 3000, refuse: "too-many-connections" })).toBe(
      "too_many_connections 3000ms",
    )
  })
})
