import type { drive_v3 } from "googleapis"

import { badRequest } from "./api.ts"

/**
 * Drive's `q` search language, the parts apps use: `name`, `mimeType` and `fullText` with `=`,
 * `!=` and `contains`; `'<id>' in parents`; `'<email>' in owners|writers|readers`; `trashed` and
 * `starred` with `=`/`!=`; `modifiedTime`/`createdTime` with comparisons; `sharedWithMe`; joined
 * with `and`, `or`, `not` and parentheses.
 */

/** What a query term is checked against. */
export interface Candidate {
  readonly file: drive_v3.Schema$File
  readonly text: string
  readonly ownerEmail: string
  readonly writers: readonly string[]
  readonly readers: readonly string[]
  readonly sharedWithMe: boolean
}

type Test = (candidate: Candidate) => boolean

const TOKEN = /\s*('(?:[^'\\]|\\.)*'|!=|<=|>=|=|<|>|\(|\)|[A-Za-z_]+)/y

function tokensOf(q: string): string[] {
  const tokens: string[] = []
  let position = 0

  while (q.slice(position).trim() !== "") {
    TOKEN.lastIndex = position

    const match = TOKEN.exec(q)

    if (!match) throw invalid()
    tokens.push(match[1] ?? "")
    position = TOKEN.lastIndex
  }

  return tokens
}

function invalid(): Error {
  return badRequest("Invalid Value", "invalid")
}

function literal(token: string | undefined): string {
  if (!token?.startsWith("'")) throw invalid()

  return token.slice(1, -1).replace(/\\(.)/g, "$1")
}

function compare(left: string, operator: string, right: string): boolean {
  switch (operator) {
    case "=":
      return left === right
    case "!=":
      return left !== right
    case "contains":
      return left.toLowerCase().includes(right.toLowerCase())
    case "<":
      return left < right
    case "<=":
      return left <= right
    case ">":
      return left > right
    case ">=":
      return left >= right
    default:
      throw invalid()
  }
}

const TEXT_FIELDS: Readonly<Record<string, (candidate: Candidate) => string>> = {
  name: (candidate) => candidate.file.name ?? "",
  mimeType: (candidate) => candidate.file.mimeType ?? "",
  fullText: (candidate) => candidate.text,
  modifiedTime: (candidate) => candidate.file.modifiedTime ?? "",
  createdTime: (candidate) => candidate.file.createdTime ?? "",
}

const FLAGS: Readonly<Record<string, (candidate: Candidate) => boolean>> = {
  trashed: (candidate) => candidate.file.trashed === true,
  starred: (candidate) => candidate.file.starred === true,
}

const COLLECTIONS: Readonly<Record<string, (candidate: Candidate) => readonly string[]>> = {
  parents: (candidate) => candidate.file.parents ?? [],
  owners: (candidate) => [candidate.ownerEmail],
  writers: (candidate) => [candidate.ownerEmail, ...candidate.writers],
  readers: (candidate) => [candidate.ownerEmail, ...candidate.writers, ...candidate.readers],
}

/** A recursive-descent reader over the tokens of one query. */
class Parser {
  private index = 0
  private readonly tokens: readonly string[]

  constructor(tokens: readonly string[]) {
    this.tokens = tokens
  }

  parse(): Test {
    const test = this.or()

    if (this.index < this.tokens.length) throw invalid()

    return test
  }

  private peek(): string | undefined {
    return this.tokens[this.index]
  }

  private take(): string | undefined {
    return this.tokens[this.index++]
  }

  private keyword(word: string): boolean {
    if (this.peek()?.toLowerCase() !== word) return false
    this.index++

    return true
  }

  private or(): Test {
    const tests = [this.and()]

    while (this.keyword("or")) tests.push(this.and())

    return (candidate) => tests.some((test) => test(candidate))
  }

  private and(): Test {
    const tests = [this.unary()]

    while (this.keyword("and")) tests.push(this.unary())

    return (candidate) => tests.every((test) => test(candidate))
  }

  private unary(): Test {
    if (this.keyword("not")) {
      const inner = this.unary()

      return (candidate) => !inner(candidate)
    }

    if (this.peek() === "(") {
      this.take()

      const inner = this.or()

      if (this.take() !== ")") throw invalid()

      return inner
    }

    return this.term()
  }

  /** `'value' in collection`, `sharedWithMe`, or `field operator value`. */
  private term(): Test {
    const first = this.take() ?? ""

    if (first.startsWith("'")) return this.membership(literal(first))
    if (first === "sharedWithMe") return (candidate) => candidate.sharedWithMe

    const operator = this.take() ?? ""
    const flag = FLAGS[first]

    if (flag) {
      const wanted = this.take() === "true"

      return (candidate) => compare(String(flag(candidate)), operator, String(wanted))
    }

    const field = TEXT_FIELDS[first]

    if (!field) throw invalid()

    const value = literal(this.take())

    return (candidate) => compare(field(candidate), operator, value)
  }

  private membership(value: string): Test {
    if (this.take()?.toLowerCase() !== "in") throw invalid()

    const collection = COLLECTIONS[this.take() ?? ""]

    if (!collection) throw invalid()

    return (candidate) => collection(candidate).includes(value)
  }
}

/** The test for a `q` value; an empty query matches every file. */
export function driveQuery(q: string | undefined): Test {
  if (!q || q.trim() === "") return () => true

  return new Parser(tokensOf(q)).parse()
}
