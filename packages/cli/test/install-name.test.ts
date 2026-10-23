import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const ROOT = fileURLToPath(new URL("../../..", import.meta.url))

/**
 * A package runner given an unscoped danwo name. On npm, `danwo` belongs to an unrelated package
 * and `danwo-playwright` is unclaimed, so a reader who copies such a command could run someone
 * else's code. Every runner command names the scoped packages: `@danwo/cli`, `@danwo/playwright`.
 */
const BARE_RUNNER = /(npx|bunx|pnpx|pnpm dlx|yarn dlx)( +(-y|--yes))? +danwo/

/** An MCP entry that starts the server through a runner with the unscoped name. */
const BARE_MCP_ARGS = /\[\s*"danwo"\s*,\s*"mcp"\s*\]/

/** Text files git tracks, without lockfiles and binaries. */
function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((path) => /\.(md|mdx|ts|tsx|mjs|json|ya?ml|toml|sh|txt)$/.test(path))
    .filter((path) => !path.endsWith("bun.lock"))
}

describe("how the docs tell people to run danwo", () => {
  it("never hands a package runner the unscoped danwo name", () => {
    const offenders = trackedTextFiles().flatMap((path) =>
      readFileSync(join(ROOT, path), "utf8")
        .split("\n")
        .flatMap((line, index) =>
          BARE_RUNNER.test(line) || BARE_MCP_ARGS.test(line) ? [`${path}:${index + 1}`] : [],
        ),
    )

    expect(offenders).toEqual([])
  })

  /*
   * Inside this bun workspace npx resolves from the root, where no `danwo` bin is linked and the
   * root package is itself named danwo, so the repository's scripts run the bin the script runner
   * puts on the PATH: the one bun links into the package's own node_modules/.bin.
   */
  it("runs danwo in the repository's own scripts by the package's bin, not through a runner", () => {
    const scripts = trackedTextFiles()
      .filter((path) => path.endsWith("package.json"))
      .flatMap((path) => {
        const manifest: { scripts?: Record<string, string> } = JSON.parse(
          readFileSync(join(ROOT, path), "utf8"),
        )

        return Object.entries(manifest.scripts ?? {}).map(([name, line]) => ({ path, name, line }))
      })
      .filter(({ line }) => /\bdanwo (test|matrix|serve)\b/.test(line))

    expect(scripts.length).toBeGreaterThan(1)
    for (const script of scripts)
      expect(script.line, `${script.path} ${script.name}`).not.toMatch(
        /\b(npx|bunx|pnpx|dlx|exec)\b[^&|;]*\bdanwo /,
      )
  })
})
