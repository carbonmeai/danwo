/** A failure as plain data: what crosses from a worker to the parent and lands in a flight record. */
import { relative } from "node:path"

export interface SourceLine {
  readonly file: string
  readonly line: number
}

export interface TestError {
  /** A short kind: the error's own `code` when it has one, else its class name. */
  readonly code: string
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

export function toTestError(error: unknown, root: string): TestError {
  if (!(error instanceof Error)) {
    return { code: "NonError", message: String(error) }
  }

  const own = "code" in error ? error.code : undefined
  const source = testFileLine(error, root)

  return {
    code: typeof own === "string" ? own : error.name,
    message: error.message,
    ...(error.stack !== undefined && { stack: error.stack }),
    ...(source !== undefined && { source }),
  }
}
