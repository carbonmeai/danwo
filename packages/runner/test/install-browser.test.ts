import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { installBrowserArgs } from "../src/browser/install.ts"

const RUNNER = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))

/** The `playwright-core` version the runner pins. */
function pinnedCore(): string {
  const pkg: unknown = JSON.parse(readFileSync(join(RUNNER, "package.json"), "utf8"))

  return String(Reflect.get(Reflect.get(Object(pkg), "dependencies"), "playwright-core"))
}

describe("danwo install-browser", () => {
  it("runs the runner's own playwright-core, keeping other installs' browsers", () => {
    const [cli = "", ...args] = installBrowserArgs()
    const core: unknown = JSON.parse(readFileSync(join(dirname(cli), "package.json"), "utf8"))

    expect(existsSync(cli)).toBe(true)
    expect(Reflect.get(Object(core), "version")).toBe(pinnedCore())
    expect(args).toEqual(["install", "chromium", "--no-remove"])
  })

  it("passes the system libraries, the headless shell and a dry run on when asked", () => {
    expect(installBrowserArgs({ withDeps: true, onlyShell: true, dryRun: true }).slice(1)).toEqual([
      "install",
      "chromium",
      "--no-remove",
      "--with-deps",
      "--only-shell",
      "--dry-run",
    ])
  })
})
