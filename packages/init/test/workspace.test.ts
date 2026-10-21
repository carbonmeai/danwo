import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { detectProject } from "../src/detect.ts"
import { runInit } from "../src/index.ts"
import { installCommand, type Runner } from "../src/install.ts"
import { mcpCommand } from "../src/setup.ts"
import { findWorkspace, isMember, pnpmPackages } from "../src/workspace.ts"
import { nextApp, project } from "./project.ts"

const SPECS = [{ name: "@danwo/cli", version: "latest" }]

/** A monorepo with the app in `apps/web`, a library in `packages/ui`, and `root` files on top. */
function monorepo(root: Readonly<Record<string, string | object>>): Promise<string> {
  return project({
    "apps/web/package.json": { ...nextApp(), name: "web" },
    "packages/ui/package.json": { name: "ui" },
    "tools/scratch/package.json": { name: "scratch" },
    ...root,
  })
}

const pnpmRoot = {
  "package.json": { name: "repo", private: true },
  "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - \"packages/**\" # libraries\n",
  "pnpm-lock.yaml": "",
}

/** Detects `dir` with no environment, as the command that would install there. */
async function install(dir: string) {
  return installCommand(await detectProject(dir, {}), SPECS)
}

describe("workspace detection", () => {
  it("reads pnpm-workspace.yaml's package globs, comments and quotes aside", () => {
    expect(pnpmPackages(pnpmRoot["pnpm-workspace.yaml"])).toEqual(["apps/*", "packages/**"])
    expect(pnpmPackages("catalog:\n  react: ^19\n")).toEqual([])
  })

  it("matches packages by glob, `!` globs left out", () => {
    expect(isMember("apps/web", ["apps/*"])).toBe(true)
    expect(isMember("apps/web/inner", ["apps/*"])).toBe(false)
    expect(isMember("packages/a/b", ["packages/**"])).toBe(true)
    expect(isMember("apps/old", ["apps/*", "!apps/old"])).toBe(false)
    expect(isMember("tools/scratch", ["apps/*"])).toBe(false)
  })

  it("finds the root above a package and the package's path in it", async () => {
    const root = await monorepo(pnpmRoot)

    expect(findWorkspace(join(root, "apps/web"))).toMatchObject({
      root,
      path: "apps/web",
      packageManager: "pnpm",
    })
    expect(findWorkspace(root)).toMatchObject({ root, path: "" })
    /* A folder under the workspace that is not one of its packages is a project of its own. */
    expect(findWorkspace(join(root, "tools/scratch"))).toBeUndefined()
  })

  it("takes the package manager from the root, not the package", async () => {
    const root = await monorepo(pnpmRoot)
    const found = await detectProject(join(root, "apps/web"), {})

    expect(found.packageManager).toBe("pnpm")
    expect(found.devCommand).toBe("pnpm dev")
  })
})

describe("installing in a workspace", () => {
  it("pnpm: adds inside the package, and with -w at the root", async () => {
    const root = await monorepo(pnpmRoot)

    expect(await install(join(root, "apps/web"))).toEqual({
      argv: ["pnpm", "add", "-D", "@danwo/cli"],
      cwd: join(root, "apps/web"),
    })
    expect(await install(root)).toEqual({
      argv: ["pnpm", "add", "-D", "@danwo/cli", "-w"],
      cwd: root,
    })
  })

  it("npm: adds to the package from the root with --workspace", async () => {
    const root = await monorepo({
      "package.json": { name: "repo", workspaces: ["apps/*", "packages/*"] },
      "package-lock.json": "{}",
    })

    expect(await install(join(root, "apps/web"))).toEqual({
      argv: ["npm", "install", "-D", "@danwo/cli", "--workspace", "apps/web"],
      cwd: root,
    })
    expect(await install(root)).toEqual({ argv: ["npm", "install", "-D", "@danwo/cli"], cwd: root })
  })

  it("Yarn 1: adds inside the package, and with -W at the root", async () => {
    const root = await monorepo({
      "package.json": { name: "repo", private: true, workspaces: { packages: ["apps/*"] } },
      "yarn.lock": "",
    })

    expect(await install(join(root, "apps/web"))).toEqual({
      argv: ["yarn", "add", "-D", "@danwo/cli"],
      cwd: join(root, "apps/web"),
    })
    expect((await install(root)).argv).toEqual(["yarn", "add", "-D", "@danwo/cli", "-W"])
  })

  it("Yarn 2 and newer: no -W, which it does not take", async () => {
    const berry = await monorepo({
      "package.json": { name: "repo", workspaces: ["apps/*"], packageManager: "yarn@4.5.0" },
    })
    const rc = await monorepo({
      "package.json": { name: "repo", workspaces: ["apps/*"] },
      "yarn.lock": "",
      ".yarnrc.yml": "nodeLinker: node-modules\n",
    })

    expect((await install(berry)).argv).toEqual(["yarn", "add", "-D", "@danwo/cli"])
    expect((await install(rc)).argv).toEqual(["yarn", "add", "-D", "@danwo/cli"])
  })

  it("Bun: adds inside the package and at the root alike", async () => {
    const root = await monorepo({
      "package.json": { name: "repo", workspaces: ["apps/*"] },
      "bun.lock": "",
    })

    expect(await install(join(root, "apps/web"))).toEqual({
      argv: ["bun", "add", "-d", "@danwo/cli"],
      cwd: join(root, "apps/web"),
    })
    expect(await install(root)).toEqual({ argv: ["bun", "add", "-d", "@danwo/cli"], cwd: root })
  })
})

/** A package manager that records what it ran and where. */
function recorder(): Runner & { calls: { argv: string[]; cwd: string }[] } {
  const calls: { argv: string[]; cwd: string }[] = []

  const run: Runner = async (argv, cwd) => {
    calls.push({ argv: [...argv], cwd })

    return { ok: true, output: "" }
  }

  return Object.assign(run, { calls })
}

describe("danwo init in a workspace package", () => {
  it("installs with the workspace's manager and registers danwo where the agents are opened", async () => {
    const root = await monorepo({ ...pnpmRoot, ".claude/settings.json": "{}" })
    const app = join(root, "apps/web")
    const run = recorder()
    const { summary, answers } = await runInit({
      cwd: app,
      flags: { yes: true, modelSource: "none" },
      env: {},
      run,
      checkDevice: async () => ({ problems: [], avd: undefined }),
    })

    expect(answers.agents).toEqual(["claude"])
    expect(run.calls[0]).toEqual({
      argv: ["pnpm", "add", "-D", "@danwo/cli", "@danwo/sdk"],
      cwd: app,
    })
    expect(existsSync(join(app, "package-lock.json"))).toBe(false)
    expect(existsSync(join(root, ".claude/skills/danwo/SKILL.md"))).toBe(true)
    expect(existsSync(join(app, ".claude"))).toBe(false)
    expect(JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        danwo: { command: "pnpm", args: ["--dir", "apps/web", "exec", "danwo", "mcp"] },
      },
    })
    expect(summary).toContain("../../.mcp.json")
    expect(existsSync(join(app, "danwo.config.ts"))).toBe(true)
  })

  it("names the config in the MCP command for a hoisting manager", () => {
    expect(mcpCommand({ root: "/r/apps/web", agentRoot: "/r", packageManager: "npm" })).toEqual([
      "npx",
      "@danwo/cli",
      "mcp",
      "--config",
      "apps/web/danwo.config.ts",
    ])
    expect(mcpCommand({ root: "/r", agentRoot: "/r", packageManager: "npm" })).toBeUndefined()
  })

  it("says how to install from the root when npm installs nothing itself", async () => {
    const root = await monorepo({
      "package.json": { name: "repo", workspaces: ["apps/*"] },
      "package-lock.json": "{}",
    })
    const { summary } = await runInit({
      cwd: join(root, "apps/web"),
      flags: { yes: true, modelSource: "none", skills: "none", skipInstall: true },
      env: {},
      checkDevice: async () => ({ problems: [], avd: undefined }),
    })

    expect(summary).toContain(
      "not installed: run (cd ../.. && npm install -D @danwo/cli @danwo/sdk --workspace apps/web)",
    )
  })
})
