/** A failure as plain data: what crosses from a worker to the parent and lands in a flight record. */
import { relative } from "node:path"

import { classOf, codeOf, type ErrorClass, type ErrorCode } from "./codes.ts"

export interface SourceLine {
  readonly file: string
  readonly line: number
}

export interface TestError {
  /** One of danwo's codes (see codes.ts); `TEST_FAILED` for an error of the test's own. */
  readonly code: ErrorCode
  /** What kind of failure the code is, which decides the run's exit and the matrix's verdict. */
  readonly class: ErrorClass
  /** The error's own name, e.g. `TypeError` for a test's own bug. */
  readonly name: string
  readonly message: string
  readonly stack?: string
  /** The test file line the failure passed through, relative to the project root. */
  readonly source?: SourceLine
}

/** A test module's stack frame: danwo imports test files with a `?danwo-realm=` query. */
const TEST_FRAME = /(?:file:\/\/)?(\/[^\s()?]+)\?danwo-realm=[^:\s)]*:(\d+):\d+/

/** The test file line `error` unwound through, relative to `root`. */
export function testFileLine(error: unknown, root: string): SourceLine | undefined {
  const match = error instanceof Error ? TEST_FRAME.exec(error.stack ?? "") : null

  if (match?.[1] === undefined || match[2] === undefined) return undefined

  return { file: relative(root, match[1]), line: Number(match[2]) }
}

/** The test file line that called the function calling this one, while a test file loads. */
export function callerLine(): number | undefined {
  return testFileLine(new Error("caller"), "/")?.line
}

export function toTestError(error: unknown, root: string): TestError {
  const code = codeOf(error)

  if (!(error instanceof Error)) {
    return { code, class: classOf(code), name: "NonError", message: String(error) }
  }

  const source = testFileLine(error, root)

  return {
    code,
    class: classOf(code),
    name: error.name,
    message: error.message,
    ...(error.stack !== undefined && { stack: error.stack }),
    ...(source !== undefined && { source }),
  }
}
