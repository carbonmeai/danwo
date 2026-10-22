import { posix, win32 } from "node:path"

import { describe, expect, it } from "vitest"

import { stackFiles } from "../src/runner/verdict.ts"
import { testFileLine } from "../src/support/errors.ts"
import { framePath, relativeSlashed, slashed } from "../src/support/paths.ts"

describe("paths as danwo stores them", () => {
  it("are relative with forward slashes on Windows", () => {
    expect(relativeSlashed(String.raw`C:\app`, String.raw`C:\app\tests\a.danwo.ts`, win32)).toBe(
      "tests/a.danwo.ts",
    )
    expect(slashed(String.raw`.danwo\runs\1`, win32)).toBe(".danwo/runs/1")
  })

  it("are left as they are where the separator is already a slash", () => {
    expect(relativeSlashed("/app", "/app/tests/a.danwo.ts", posix)).toBe("tests/a.danwo.ts")
    expect(slashed(String.raw`odd\name`, posix)).toBe(String.raw`odd\name`)
  })
})

describe("a stack frame's file", () => {
  it("decodes a Windows file URL into a drive path, dropping the query", () => {
    expect(framePath("file:///C:/My%20App/a.ts?danwo-realm=1-2", win32)).toBe(
      String.raw`C:\My App\a.ts`,
    )
    expect(framePath("file:///C:/a.ts?danwo-realm=1", win32, true)).toBe(
      String.raw`C:\a.ts?danwo-realm=1`,
    )
  })

  it("decodes a POSIX file URL and leaves a plain path alone", () => {
    expect(framePath("file:///srv/my%20app/a.ts", posix)).toBe("/srv/my app/a.ts")
    expect(framePath(String.raw`C:\a.ts`, win32)).toBe(String.raw`C:\a.ts`)
  })
})

/** An error thrown through `frame`. */
const failure = (frame: string) =>
  Object.assign(new Error("boom"), { stack: `Error: boom\n    at run (${frame})` })

describe("the test file line a failure passed through", () => {
  it("reads a Windows frame, drive letter and all", () => {
    const error = failure("file:///C:/app/tests/pay.danwo.ts?danwo-realm=42-1:17:9")

    expect(testFileLine(error, String.raw`C:\app`, win32)).toEqual({
      file: "tests/pay.danwo.ts",
      line: 17,
    })
  })

  it("reads a POSIX frame, with spaces in the path", () => {
    const error = failure("file:///home/jo%20doe/app/tests/pay.danwo.ts?danwo-realm=42-1:3:1")

    expect(testFileLine(error, "/home/jo doe/app", posix)).toEqual({
      file: "tests/pay.danwo.ts",
      line: 3,
    })
  })
})

describe("the files of a stack's frames", () => {
  it("turns Windows file URLs into drive paths and keeps a test file's realm", () => {
    const trace = [
      "TypeError: x",
      "    at f (file:///C:/danwo/src/a.ts:1:2)",
      "    at node:internal/x:3:4",
      "    at file:///C:/app/t.danwo.ts?danwo-realm=1:5:6",
    ].join("\n")

    expect(stackFiles(trace, win32)).toEqual([
      String.raw`C:\danwo\src\a.ts`,
      String.raw`C:\app\t.danwo.ts?danwo-realm=1`,
    ])
  })
})
