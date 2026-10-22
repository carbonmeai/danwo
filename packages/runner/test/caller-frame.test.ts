import { posix, win32 } from "node:path"

import { describe, expect, it } from "vitest"

import { ownFrame } from "../src/record/source.ts"

/** A stack through each of `frames`, top first. */
const stack = (...frames: string[]) => ["Error", ...frames.map((f) => `    at f (${f})`)].join("\n")

describe("the line of the user's code that called into the runner", () => {
  it("skips the installed runner and finds the test on Windows", () => {
    const frames = stack(
      "file:///C:/danwo/src/session.ts:1:1",
      "file:///C:/app/node_modules/@danwo/runner/src/session.ts:10:3",
      "file:///C:/app/tests/pay.danwo.ts?danwo-realm=1-1:8:5",
    )

    expect(ownFrame(frames, String.raw`C:\app`, win32, "C:\\danwo\\src\\")).toEqual({
      file: "tests/pay.danwo.ts",
      line: 8,
    })
  })

  it("reads a plain Windows path as well", () => {
    const frames = stack(String.raw`C:\app\tests\helpers.ts:4:2`)

    expect(ownFrame(frames, String.raw`C:\app`, win32, "C:\\danwo\\src\\")).toEqual({
      file: "tests/helpers.ts",
      line: 4,
    })
  })

  it("skips danwo's own source on macOS and Linux", () => {
    const frames = stack(
      "/danwo/src/session.ts:1:1",
      "file:///app/tests/a.danwo.ts?danwo-realm=1:2:3",
    )

    expect(ownFrame(frames, "/app", posix, "/danwo/src/")).toEqual({
      file: "tests/a.danwo.ts",
      line: 2,
    })
  })
})
