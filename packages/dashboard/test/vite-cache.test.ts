import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { DEDUPE, dependencyHash, depsCacheDir } from "../src/vite-cache.ts"
import config from "../vite.config.ts"

const root = mkdtempSync(join(tmpdir(), "danwo-vite-cache-"))

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

/** A dashboard folder inside a project with `lock` as its lockfile. */
function project(name: string, lock: string): string {
  const dashboard = join(root, name, "packages", "dashboard")

  mkdirSync(dashboard, { recursive: true })
  writeFileSync(join(dashboard, "package.json"), '{"name":"@danwo/dashboard"}')
  writeFileSync(join(root, name, "bun.lock"), lock)

  return dashboard
}

describe("the dashboard's Vite dependency cache", () => {
  it("keeps one folder per set of installed dependencies", () => {
    const before = project("a", "react@19.2.8")
    const after = project("b", "react@19.2.8\nrecharts@3.9.0")

    expect(dependencyHash(before)).not.toBe(dependencyHash(after))
    expect(depsCacheDir(before)).toBe(
      join(before, "node_modules", ".vite", `deps-${dependencyHash(before)}`),
    )
    expect(dependencyHash(before)).toBe(dependencyHash(before))
  })

  it("is the config danwo serve starts with, with React loaded once", () => {
    const served = config({ command: "serve", mode: "development" })

    expect(served.cacheDir).toMatch(/[/\\]node_modules[/\\]\.vite[/\\]deps-[0-9a-f]{12}$/)
    expect(served.resolve?.dedupe).toEqual([...DEDUPE])
  })

  it("bundles the built server's dependencies but the runner", () => {
    expect(config({ command: "serve", mode: "development" }).environments).toBeUndefined()
    expect(config({ command: "build", mode: "production" }).environments?.ssr?.resolve).toEqual({
      noExternal: true,
    })
  })
})
