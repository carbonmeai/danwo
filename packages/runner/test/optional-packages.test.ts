import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { codeOf, exitCodeForError } from "../src/support/codes.ts"
import {
  addCommand,
  isMissingPackage,
  loadOptional,
  PackageMissingError,
  packageManagerAt,
  packageOf,
} from "../src/support/optional-packages.ts"

const root = mkdtempSync(join(tmpdir(), "danwo-optional-"))

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

/** A folder under the test's root holding `files`. */
function folder(name: string, files: Readonly<Record<string, string>>): string {
  const dir = join(root, name)

  mkdirSync(dir, { recursive: true })
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)

  return dir
}

/** Node's error for a bare import of `specifier` that is not installed. */
function notFound(specifier: string): Error {
  return Object.assign(
    new Error(`Cannot find package '${specifier}' imported from /app/node_modules/x/bin.ts`),
    { code: "ERR_MODULE_NOT_FOUND" },
  )
}

describe("optional packages", () => {
  it("adds one with the project's package manager, from its lockfile or packageManager", () => {
    const pnpm = folder("pnpm", { "pnpm-lock.yaml": "" })
    const nested = join(pnpm, "apps", "web")

    mkdirSync(nested, { recursive: true })

    expect(packageManagerAt(nested)).toBe("pnpm")
    expect(packageManagerAt(folder("bun", { "bun.lock": "" }))).toBe("bun")
    expect(
      packageManagerAt(folder("yarn", { "package.json": '{ "packageManager": "yarn@4.9.0" }' })),
    ).toBe("yarn")
    expect(addCommand("@danwo/mobile", pnpm)).toBe("pnpm add -D @danwo/mobile")
    expect(addCommand("@danwo/mcp", folder("none", {}))).toBe("npm install -D @danwo/mcp")
  })

  it("tells the package missing from one that a package it needs is missing", () => {
    expect(isMissingPackage(notFound("@danwo/mobile"), "@danwo/mobile")).toBe(true)
    expect(isMissingPackage(notFound("@danwo/mobile/build"), "@danwo/mobile")).toBe(true)
    expect(isMissingPackage(notFound("agent-device"), "@danwo/mobile")).toBe(false)
    expect(isMissingPackage(notFound("@danwo/mobilex"), "@danwo/mobile")).toBe(false)
    expect(packageOf("@danwo/mobile/build")).toBe("@danwo/mobile")
  })

  it("fails a command without one with PACKAGE_MISSING, the exit code 2 and the install", async () => {
    const failed: unknown = await loadOptional("@danwo/mobile", "danwo build-ios", () =>
      Promise.reject(notFound("@danwo/mobile/build")),
    ).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(PackageMissingError)
    expect(codeOf(failed)).toBe("PACKAGE_MISSING")
    expect(exitCodeForError(failed)).toBe(2)
    expect(String(Reflect.get(Object(failed), "message"))).toMatch(
      /^danwo build-ios needs @danwo\/mobile: (npm install -D|bun add -d|pnpm add -D|yarn add -D) @danwo\/mobile$/,
    )
  })

  it("passes on any other failure as it is, and loads an installed package", async () => {
    const other = new Error("boom")

    await expect(loadOptional("@danwo/mcp", "danwo mcp", () => Promise.reject(other))).rejects.toBe(
      other,
    )
    await expect(loadOptional("@danwo/mcp", "danwo mcp", async () => 42)).resolves.toBe(42)
  })
})
