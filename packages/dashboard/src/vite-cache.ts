/**
 * Where the dashboard's Vite dev server keeps its pre-bundled dependencies, and which packages it
 * must load once. A long-running or upgraded `danwo serve` otherwise reuses bundles made for older
 * dependencies, and a page can end up with two copies of React ("Cannot read properties of null
 * (reading 'useContext')").
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** Packages every module must share one copy of. */
export const DEDUPE = ["react", "react-dom"] as const

const LOCKFILES = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"]

/** The nearest lockfile at or above `from`, if any. */
function nearestLockfile(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const found = LOCKFILES.map((name) => join(dir, name)).find((path) => existsSync(path))

    if (found !== undefined) return found
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * A short hash of what decides the dependency bundles: the dashboard's and the design system's
 * `package.json`, and the lockfile the install came from.
 */
export function dependencyHash(dashboardRoot: string): string {
  const hash = createHash("sha256")
  const inputs = [
    join(dashboardRoot, "package.json"),
    join(dashboardRoot, "..", "ui", "package.json"),
    nearestLockfile(dashboardRoot),
  ]

  for (const path of inputs)
    if (path !== undefined && existsSync(path)) hash.update(readFileSync(path))

  return hash.digest("hex").slice(0, 12)
}

/**
 * The dependency cache for this set of dependencies: a folder per hash, so a change of dependencies
 * starts from fresh bundles instead of mixing old and new ones.
 */
export function depsCacheDir(dashboardRoot: string): string {
  return join(dashboardRoot, "node_modules", ".vite", `deps-${dependencyHash(dashboardRoot)}`)
}
