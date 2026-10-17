/** Which line of a test file called into the runner, read from the call stack. */
import { isAbsolute, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

export interface SourceLine {
  /** The file, relative to the project root. */
  readonly file: string
  readonly line: number
}

/** The runner's own source directory: frames inside it are the runner, not the test. */
const RUNNER_SRC = fileURLToPath(new URL("..", import.meta.url))

/** `at fn (file:///a/b.ts?q=1:12:5)` or `at /a/b.ts:12:5` → path and line. */
const FRAME = /\(?((?:file:\/\/)?\/[^\s():?]+)(?:\?[^\s():]*)?:(\d+):\d+\)?\s*$/

function frameOf(line: string): { path: string; line: number } | undefined {
  const match = FRAME.exec(line)

  if (match?.[1] === undefined || match[2] === undefined) return undefined

  const path = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1]

  return { path, line: Number(match[2]) }
}

function isOwnCode(path: string, root: string): boolean {
  const inside = relative(root, path)

  return (
    !path.startsWith(RUNNER_SRC) &&
    !path.includes(`${sep}node_modules${sep}`) &&
    !inside.startsWith("..") &&
    !isAbsolute(inside)
  )
}

/** The first frame of the current stack inside `projectRoot` that is not the runner itself. */
export function callerLine(projectRoot: string): SourceLine | undefined {
  const limit = Error.stackTraceLimit

  Error.stackTraceLimit = 50

  const stack = new Error().stack

  Error.stackTraceLimit = limit

  for (const line of stack?.split("\n").slice(1) ?? []) {
    const frame = frameOf(line)

    if (frame !== undefined && isOwnCode(frame.path, projectRoot))
      return { file: relative(projectRoot, frame.path), line: frame.line }
  }

  return undefined
}
