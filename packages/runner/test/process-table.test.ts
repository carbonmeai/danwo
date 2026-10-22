import { describe, expect, it } from "vitest"

import { keepPreloadAdvice } from "../src/runner/app-checks.ts"
import {
  descendantsOf,
  listingCommand,
  parseListing,
  processRows,
  processRowsAsync,
  type ProcessRow,
  programName,
} from "../src/support/process-table.ts"

describe("the process listing", () => {
  it("reads ps output, with or without carriage returns", () => {
    const table = "  101     1 /usr/bin/node app.mts\r\n  202   101 node worker.ts --x\n\n"

    expect(parseListing("linux", table)).toEqual([
      { pid: 101, ppid: 1, command: "/usr/bin/node app.mts", started: 0 },
      { pid: 202, ppid: 101, command: "node worker.ts --x", started: 0 },
    ])
  })

  it("reads the Windows listing, which gives one object alone and withholds some command lines", () => {
    const many = JSON.stringify([
      { pid: 4, ppid: 0, command: null, started: 0 },
      { pid: 900, ppid: 4, command: String.raw`"C:\nodejs\node.exe" app.mts`, started: 1_000 },
    ])

    expect(parseListing("win32", many)).toEqual([
      { pid: 4, ppid: 0, command: "", started: 0 },
      { pid: 900, ppid: 4, command: String.raw`"C:\nodejs\node.exe" app.mts`, started: 1_000 },
    ])
    expect(parseListing("win32", '{"pid":7,"ppid":1,"command":"x","started":5}')).toEqual([
      { pid: 7, ppid: 1, command: "x", started: 5 },
    ])
    expect(parseListing("win32", "\r\n")).toEqual([])
  })

  it("asks ps on macOS and Linux, and PowerShell without its profile on Windows", () => {
    expect(listingCommand("darwin")).toEqual(["ps", ["-A", "-ww", "-o", "pid=,ppid=,command="]])

    const [program, args] = listingCommand("win32")

    expect(program).toBe("powershell.exe")
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"])
    expect(args[3]).toMatch(/Win32_Process.*ParentProcessId.*CreationDate.*ConvertTo-Json/)
  })

  it("lists this machine, this process among them", async () => {
    expect(processRows().some((row) => row.pid === process.pid)).toBe(true)
    expect((await processRowsAsync()).some((row) => row.pid === process.pid)).toBe(true)
  })
})

/** A process `pid` under `ppid`, started at `started`. */
const row = (pid: number, ppid: number, started = 0): ProcessRow => ({
  pid,
  ppid,
  command: `p${pid}`,
  started,
})

describe("a process's descendants", () => {
  it("follows parent ids down every generation", () => {
    const rows = [row(1, 0), row(10, 1), row(11, 10), row(12, 11), row(20, 2)]

    expect(descendantsOf(rows, 1).map((found) => found.pid)).toEqual([10, 11, 12])
  })

  it("skips a process whose parent id names an earlier owner of a reused pid", () => {
    /* 30 started before 10 did, so the 10 it names as parent was another process. */
    const rows = [row(1, 0, 100), row(10, 1, 200), row(30, 10, 150), row(31, 10, 250)]

    expect(descendantsOf(rows, 1).map((found) => found.pid)).toEqual([10, 31])
  })

  it("does not loop on a cycle of parent ids", () => {
    expect(descendantsOf([row(0, 0), row(5, 5)], 0)).toEqual([])
  })
})

describe("the program a command line starts", () => {
  it("is the file name, without a folder or .exe", () => {
    expect(programName("/usr/local/bin/node app.js")).toBe("node")
    expect(programName(String.raw`"C:\Program Files\nodejs\node.exe" app.js`)).toBe("node")
    expect(programName(String.raw`C:\nodejs\NODE.EXE --import x`)).toBe("NODE")
    expect(programName('"unterminated')).toBe("unterminated")
  })
})

describe("the advice for a start script that drops the preload", () => {
  it("names the shim where there is one, and the cmd.exe syntax on Windows", () => {
    expect(keepPreloadAdvice("linux")).toMatch(/PATH's node/)
    expect(keepPreloadAdvice("win32")).toMatch(/%NODE_OPTIONS%/)
    expect(keepPreloadAdvice("win32")).not.toMatch(/shim/)
  })
})
