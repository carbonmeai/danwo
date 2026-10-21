/**
 * What a SQL statement does, from its text alone: its verb, the table it writes or reads first,
 * and its role for planning faults. Best effort: it reads the start of the statement, not a full
 * parse, which is enough to tell `UPDATE orders` from `COMMIT`.
 */
import type { DataRole } from "../types.ts"

export interface Statement {
  readonly verb: string
  readonly table?: string
  readonly role: DataRole
}

/** Transaction verbs and the name reports use for each. */
const BOUNDARIES = new Map([
  ["BEGIN", "BEGIN"],
  ["START", "BEGIN"],
  ["COMMIT", "COMMIT"],
  ["END", "COMMIT"],
  ["ROLLBACK", "ROLLBACK"],
  ["ABORT", "ROLLBACK"],
  ["SAVEPOINT", "SAVEPOINT"],
  ["RELEASE", "RELEASE"],
])

/** A table name, maybe schema-qualified and quoted: the last part, lower case. */
const NAME = String.raw`"?[A-Za-z_][\w$]*"?(?:\s*\.\s*"?[A-Za-z_][\w$]*"?)?`

const WRITES: readonly (readonly [string, RegExp])[] = [
  ["INSERT", new RegExp(String.raw`\binsert\s+into\s+(${NAME})`, "i")],
  ["UPDATE", new RegExp(String.raw`\bupdate\s+(?:only\s+)?(${NAME})`, "i")],
  ["DELETE", new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?(${NAME})`, "i")],
  ["MERGE", new RegExp(String.raw`\bmerge\s+into\s+(${NAME})`, "i")],
]

/**
 * A row-locking clause (`FOR UPDATE SKIP LOCKED`, `FOR NO KEY UPDATE OF t NOWAIT`, `FOR SHARE`).
 * It locks what a SELECT reads and writes nothing, so it must not read as an `UPDATE`.
 */
const LOCKING = new RegExp(
  String.raw`\bfor\s+(?:no\s+key\s+update|update|key\s+share|share)\b(?:\s+of\s+${NAME}(?:\s*,\s*${NAME})*)?(?:\s+nowait|\s+skip\s+locked)?`,
  "gi",
)

const FROM = new RegExp(String.raw`\bfrom\s+(?:only\s+)?(${NAME})`, "i")

/** The statement without leading comments, whitespace and opening parentheses. */
function trimmed(sql: string): string {
  let rest = sql

  for (;;) {
    const next = rest.replace(/^(?:\s+|\(|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/, "")

    if (next === rest) return rest
    rest = next
  }
}

/** The last, unquoted part of a possibly qualified name. */
function tableName(name: string): string {
  return (name.split(".").at(-1) ?? name).replaceAll('"', "").trim().toLowerCase()
}

/** The first data-changing clause anywhere in the statement (a `WITH … UPDATE` reads that way). */
function writeIn(sql: string): Statement | undefined {
  const unlocked = sql.replace(LOCKING, " ")

  for (const [verb, pattern] of WRITES) {
    const match = pattern.exec(unlocked)

    if (match?.[1] !== undefined) return { verb, table: tableName(match[1]), role: "write" }
  }

  return undefined
}

/** What `sql` does. Several statements in one string are read by the first. */
export function classify(sql: string): Statement {
  const text = trimmed(sql)
  const first = /^[A-Za-z]+/.exec(text)?.[0]?.toUpperCase() ?? ""
  const boundary = BOUNDARIES.get(first)

  if (boundary !== undefined) return { verb: boundary, role: "boundary" }
  if (first === "WITH") return writeIn(text) ?? select(text)
  if (WRITES.some(([verb]) => verb === first))
    return writeIn(text) ?? { verb: first, role: "write" }
  if (first === "SELECT") return select(text)

  return { verb: first || "UNKNOWN", role: "other" }
}

/** A SELECT reads the first table it names; one without a table (`SELECT 1`) is housekeeping. */
function select(sql: string): Statement {
  const match = FROM.exec(sql)

  return match?.[1] === undefined
    ? { verb: "SELECT", role: "other" }
    : { verb: "SELECT", table: tableName(match[1]), role: "read" }
}

/** How a statement reads in calls and fault labels: `UPDATE orders`, `COMMIT`. */
export function operationOf(statement: Statement): string {
  return statement.table === undefined ? statement.verb : `${statement.verb} ${statement.table}`
}
