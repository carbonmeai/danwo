import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { checkName, folderSuiteName, slugOf, suiteIdentity, trackedConfigs } from "../src/suite.ts"

const WORKSPACE = join(tmpdir(), "repo")
const one = () => ["danwo.config.ts"]
const two = () => ["packages/dashboard/e2e/danwo.config.ts", "website/e2e/danwo.config.ts"]

describe("a suite's name on GitHub", () => {
  it("leaves a repository's one suite unnamed, as it always was", () => {
    const suite = suiteIdentity({ root: join(WORKSPACE, "e2e") }, WORKSPACE, { configs: one })

    expect(suite).toEqual({ name: undefined, slug: undefined, artifact: "danwo-runs" })
    expect(checkName("test", suite)).toBe("danwo")
    expect(checkName("matrix", suite)).toBe("danwo matrix")
  })

  it("names each of several suites after its config's folder, past folders such as e2e", () => {
    const root = join(WORKSPACE, "packages", "dashboard", "e2e")
    const suite = suiteIdentity({ root }, WORKSPACE, { configs: two })

    expect(suite).toEqual({
      name: "dashboard",
      slug: "dashboard",
      artifact: "danwo-runs-dashboard",
    })
    expect(checkName("test", suite)).toBe("danwo · dashboard")
    expect(checkName("matrix", suite)).toBe("danwo matrix · dashboard")
  })

  it("takes the run's own name first, and an explicit artifact over the derived one", () => {
    const root = join(WORKSPACE, "website", "e2e")
    const named = suiteIdentity({ root, suite: "Web Site" }, WORKSPACE, { configs: one })
    const kept = suiteIdentity({ root, suite: "site" }, WORKSPACE, {
      configs: one,
      artifact: "runs",
    })

    expect(named).toEqual({ name: "Web Site", slug: "web-site", artifact: "danwo-runs-web-site" })
    expect(kept.artifact).toBe("runs")
  })

  it("reads a folder's name, and none at the workspace's root", () => {
    expect(folderSuiteName(join(WORKSPACE, "apps", "web"), WORKSPACE)).toBe("web")
    expect(folderSuiteName(join(WORKSPACE, "tests", "e2e"), WORKSPACE)).toBe("e2e")
    expect(folderSuiteName(WORKSPACE, WORKSPACE)).toBeUndefined()
    expect(slugOf("--")).toBe("suite")
  })
})

describe("the danwo configs git tracks", () => {
  let repo: string | undefined

  afterEach(async () => {
    if (repo) await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    repo = undefined
  })

  it("lists every tracked danwo.config, and none outside a repository", async () => {
    repo = await mkdtemp(join(tmpdir(), "danwo-suites-"))
    await mkdir(join(repo, "web", "e2e"), { recursive: true })
    await writeFile(join(repo, "danwo.config.ts"), "")
    await writeFile(join(repo, "web", "e2e", "danwo.config.mts"), "")
    await writeFile(join(repo, "web", "danwo.config.json"), "")
    execFileSync("git", ["init", "-q"], { cwd: repo })
    execFileSync("git", ["add", "."], { cwd: repo })

    expect(trackedConfigs(repo).toSorted()).toEqual(["danwo.config.ts", "web/e2e/danwo.config.mts"])
    expect(trackedConfigs(join(repo, "missing"))).toEqual([])
  })
})
