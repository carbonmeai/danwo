import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { clientCommand, initProject, initReport } from "../src/mcp-clients.ts"

describe("registering the MCP server with coding agents", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-init-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it("creates the three client configs, then leaves them alone", async () => {
    const first = await initProject({ cwd: dir, skill: false, platform: "linux" })

    expect(first.map((change) => change.outcome)).toEqual(["created", "created", "created"])
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { danwo: { command: "npx", args: ["@danwo/cli", "mcp"] } },
    })
    expect(await readFile(join(dir, ".codex/config.toml"), "utf8")).toBe(
      '[mcp_servers.danwo]\ncommand = "npx"\nargs = ["@danwo/cli","mcp"]\n',
    )
    expect(initReport(await initProject({ cwd: dir, skill: false, platform: "linux" }))).toBe(
      "unchanged .mcp.json\nunchanged .cursor/mcp.json\nunchanged .codex/config.toml",
    )
  })

  it("starts npx through cmd /c on Windows, where clients start a server without a shell", async () => {
    await initProject({ cwd: dir, skill: false, platform: "win32" })

    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { danwo: { command: "cmd", args: ["/c", "npx", "@danwo/cli", "mcp"] } },
    })
    expect(await readFile(join(dir, ".codex/config.toml"), "utf8")).toBe(
      '[mcp_servers.danwo]\ncommand = "cmd"\nargs = ["/c","npx","@danwo/cli","mcp"]\n',
    )
    expect(clientCommand(["node", "server.js"], "win32")).toEqual(["node", "server.js"])
  })

  it("merges into existing configs, keeping their other servers", async () => {
    await mkdir(join(dir, ".codex"))
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } }, extra: true }),
    )
    await writeFile(
      join(dir, ".codex/config.toml"),
      'model = "o5"\n\n[mcp_servers.danwo]\ncommand = "old"\n\n[mcp_servers.other]\ncommand = "other"\n',
    )

    const changes = await initProject({
      cwd: dir,
      starterConfig: true,
      skill: false,
      platform: "linux",
    })

    expect(changes.map((change) => `${change.outcome} ${change.file}`)).toEqual([
      "updated .mcp.json",
      "created .cursor/mcp.json",
      "updated .codex/config.toml",
      "created danwo.config.ts",
    ])
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        other: { command: "other" },
        danwo: { command: "npx", args: ["@danwo/cli", "mcp"] },
      },
      extra: true,
    })
    expect(await readFile(join(dir, ".codex/config.toml"), "utf8")).toBe(
      'model = "o5"\n\n[mcp_servers.danwo]\ncommand = "npx"\nargs = ["@danwo/cli","mcp"]\n\n[mcp_servers.other]\ncommand = "other"\n',
    )
    expect(await readFile(join(dir, "danwo.config.ts"), "utf8")).toContain("defineConfig")
  })

  it("installs the skill with the client configs, keeping an edited copy", async () => {
    const report = initReport(await initProject({ cwd: dir }))

    expect(report).toContain("created   .claude/skills/danwo/SKILL.md")
    expect(report).toContain("created   .agents/skills/danwo/SKILL.md")

    await writeFile(join(dir, ".claude/skills/danwo/SKILL.md"), "mine\n")
    expect(initReport(await initProject({ cwd: dir }))).toContain(
      "kept      .claude/skills/danwo/SKILL.md (edited here",
    )
    expect(await readFile(join(dir, ".claude/skills/danwo/SKILL.md"), "utf8")).toBe("mine\n")
  })

  it("registers the server in VS Code's config when asked, under its typed servers key", async () => {
    await mkdir(join(dir, ".vscode"))
    await writeFile(
      join(dir, ".vscode/mcp.json"),
      JSON.stringify({ servers: { other: { type: "http", url: "http://x.test" } } }),
    )

    const changes = await initProject({
      cwd: dir,
      clients: [".vscode/mcp.json"],
      skill: false,
      platform: "linux",
    })

    expect(changes.map((change) => `${change.outcome} ${change.file}`)).toEqual([
      "updated .vscode/mcp.json",
    ])
    expect(JSON.parse(await readFile(join(dir, ".vscode/mcp.json"), "utf8"))).toEqual({
      servers: {
        other: { type: "http", url: "http://x.test" },
        danwo: { type: "stdio", command: "npx", args: ["@danwo/cli", "mcp"] },
      },
    })
    expect(existsSync(join(dir, ".mcp.json"))).toBe(false)
  })

  it("refuses to rewrite a config that is not JSON", async () => {
    await writeFile(join(dir, ".mcp.json"), "{ not json")

    await expect(initProject({ cwd: dir, skill: false })).rejects.toThrow(
      /\.mcp\.json is not a JSON object/,
    )
  })
})
