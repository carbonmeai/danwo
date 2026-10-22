/** Which line of a test file called into the runner, read from the call stack. */
import nodePath, { type PlatformPath } from "node:path"
import { fileURLToPath } from "node:url"

import { framePath, relativeSlashed } from "../support/paths.ts"

export interface SourceLine {
  /** The file, relative to the project root. */
  readonly file: string
  readonly line: number
}

/** The runner's own source directory: frames inside it are the runner, not the test. */
const RUNNER_SRC = fileURLToPath(new URL("..", import.meta.url))

/**
 * `at fn (file:///a/b.ts?q=1:12:5)`, `at /a/b.ts:12:5`, or on Windows `file:///C:/a/b.ts:12:5`
 * and `C:\a\b.ts:12:5` → path and line.
 */
const FRAME =
  /\(?(file:\/\/[^\s()?]+?|\/[^\s():?]+|[A-Za-z]:\\[^\s():?]+)(?:\?[^\s():]*)?:(\d+):\d+\)?\s*$/

function frameOf(line: string, platform: PlatformPath): { path: string; line: number } | undefined {
  const match = FRAME.exec(line)

  if (match?.[1] === undefined || match[2] === undefined) return undefined

  return { path: framePath(match[1], platform), line: Number(match[2]) }
}

function isOwnCode(path: string, root: string, platform: PlatformPath, runnerSrc: string): boolean {
  const inside = platform.relative(root, path)

  return (
    !path.startsWith(runnerSrc) &&
    !path.includes(`${platform.sep}node_modules${platform.sep}`) &&
    !inside.startsWith("..") &&
    !platform.isAbsolute(inside)
  )
}

/**
 * The first line of `stack` inside `projectRoot` that is neither the runner's own code (under
 * `runnerSrc`) nor an installed package's.
 */
export function ownFrame(
  stack: string,
  projectRoot: string,
  platform: PlatformPath = nodePath,
  runnerSrc: string = RUNNER_SRC,
): SourceLine | undefined {
  for (const line of stack.split("\n").slice(1)) {
    const frame = frameOf(line, platform)

    if (frame !== undefined && isOwnCode(frame.path, projectRoot, platform, runnerSrc))
      return { file: relativeSlashed(projectRoot, frame.path, platform), line: frame.line }
  }

  return undefined
}

/** The first frame of the current stack inside `projectRoot` that is not the runner itself. */
export function callerLine(projectRoot: string): SourceLine | undefined {
  const limit = Error.stackTraceLimit

  Error.stackTraceLimit = 50

  const stack = new Error().stack

  Error.stackTraceLimit = limit

  return ownFrame(stack ?? "", projectRoot)
}
