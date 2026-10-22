import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { quoteForCmd, spawnPlan } from "../src/support/command-line.ts"

describe("starting a program by name", () => {
  it("starts it directly on macOS and Linux", () => {
    expect(spawnPlan("npm", ["install", "a b"], "linux")).toEqual({
      command: "npm",
      args: ["install", "a b"],
      windowsVerbatimArguments: false,
    })
  })

  it("goes through cmd.exe on Windows, where npm and npx are .cmd scripts", () => {
    expect(spawnPlan("npx", ["--no", "--", "danwo", "test"], "win32", "cmd.exe")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", '"npx ^"--no^" ^"--^" ^"danwo^" ^"test^""'],
      windowsVerbatimArguments: true,
    })
  })

  it("uses the cmd.exe that ComSpec names", () => {
    expect(spawnPlan("npm", [], "win32", String.raw`C:\Windows\system32\cmd.exe`).command).toBe(
      String.raw`C:\Windows\system32\cmd.exe`,
    )
  })
})

describe("quoting one argument for cmd.exe", () => {
  it("keeps a path with spaces whole", () => {
    expect(quoteForCmd(String.raw`C:\Users\Jane Doe\app.tgz`)).toBe(
      String.raw`^"C:\Users\Jane^ Doe\app.tgz^"`,
    )
  })

  it("passes command separators and carets through as text", () => {
    expect(quoteForCmd("a&b|c")).toBe('^"a^&b^|c^"')
    expect(quoteForCmd("^1.2.3")).toBe('^"^^1.2.3^"')
  })

  it("escapes a quote for the program, doubling the backslashes before it", () => {
    expect(quoteForCmd(String.raw`say "hi"`)).toBe(String.raw`^"say^ \^"hi\^"^"`)
    expect(quoteForCmd(String.raw`dir\"`)).toBe(String.raw`^"dir\\\^"^"`)
  })

  it("doubles trailing backslashes, so the closing quote stays a quote", () => {
    expect(quoteForCmd("C:\\dir\\")).toBe(String.raw`^"C:\dir\\^"`)
  })
})

describe.runIf(process.platform === "win32")("on Windows, through a real .cmd script", () => {
  const dir = mkdtempSync(join(tmpdir(), "danwo cmd "))

  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

  it("hands every argument over exactly as given", () => {
    writeFileSync(join(dir, "echo.js"), "console.log(JSON.stringify(process.argv.slice(2)))\n")
    writeFileSync(join(dir, "echo-args.cmd"), `@"${process.execPath}" "%~dp0echo.js" %*\r\n`)

    const given = ["plain", "two words", "a&b", "^1.2.3", 'say "hi"', String.raw`C:\a b\\`, "50%"]
    const plan = spawnPlan(join(dir, "echo-args.cmd"), given)
    const result = spawnSync(plan.command, [...plan.args], {
      encoding: "utf8",
      windowsVerbatimArguments: true,
    })

    expect(JSON.parse(result.stdout)).toEqual(given)
  })
})
