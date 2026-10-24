import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, test } from "vitest"

const SCRIPT = fileURLToPath(new URL("../pack-files.ts", import.meta.url))
const ROOT = fileURLToPath(new URL("../..", import.meta.url))

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A package folder as the release stages it, before `pack-files.ts add` runs in it. */
function stagedPackage(): string {
  const dir = mkdtempSync(join(tmpdir(), "danwo-pack-files-"))

  made.push(dir)
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@danwo/example", description: "An example package." }),
  )

  return dir
}

/** Runs `pack-files.ts` with `action` in `dir`. */
function packFiles(action: "add" | "remove", dir: string): void {
  execFileSync(process.execPath, [SCRIPT, action], { cwd: dir, stdio: "pipe" })
}

describe("the files a package ships", () => {
  test("a NOTICE of the package's own: the copyright and the Apache licence, nothing else", () => {
    const dir = stagedPackage()

    packFiles("add", dir)

    const notice = readFileSync(join(dir, "NOTICE"), "utf8")

    expect(notice).toBe(
      [
        "dánwò (danwo)",
        "Copyright 2026 Carbonme Inc",
        "",
        "This product is licensed under the Apache License, Version 2.0 (see LICENSE).",
        "",
      ].join("\n"),
    )
    /* What made scanners call the package non-permissive: the brand and the wordmark's font. */
    expect(notice).not.toMatch(/trademark|not licensed|Open Font|OFL/i)
    expect(readFileSync(join(ROOT, "NOTICE"), "utf8")).toMatch(/not licensed under the Apache/)
  })

  test("the repository's LICENSE and a README, all removed again after packing", () => {
    const dir = stagedPackage()

    packFiles("add", dir)

    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toBe(
      readFileSync(join(ROOT, "LICENSE"), "utf8"),
    )
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("An example package.")

    packFiles("remove", dir)

    for (const file of ["LICENSE", "NOTICE", "README.md"])
      expect(existsSync(join(dir, file))).toBe(false)
  })
})
