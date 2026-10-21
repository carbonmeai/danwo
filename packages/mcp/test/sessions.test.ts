import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { locatorCode, parseLocator } from "@danwo/recorder"
import { parseFault } from "@danwo/runner/runner"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { initProject, initReport } from "../src/init.ts"
import { snapshotChange } from "../src/sessions/diff.ts"

describe("locator expressions", () => {
  it("reads the screen's queries as a test writes them", () => {
    expect(parseLocator('getByRole("button", { name: "Pay" })')).toEqual({
      by: "role",
      value: "button",
      name: "Pay",
    })
    expect(parseLocator("screen.getByLabel('Email', { exact: true })")).toEqual({
      by: "label",
      value: "Email",
      exact: true,
    })
    expect(parseLocator("getByText(/^Credits: /i)").value).toEqual(/^Credits: /i)
    expect(locatorCode(parseLocator('getByTestId("checkout-pay")'))).toBe(
      'screen.getByTestId("checkout-pay")',
    )
  })

  it("refuses what is not one of the queries", () => {
    expect(() => parseLocator("page.locator('#pay')")).toThrow(/is not a locator/)
  })
})

describe("fault names", () => {
  it("reads outbound faults onto the route the matrix names", () => {
    expect(parseFault("status 500 on POST api.stripe.com/v1/checkout/sessions")).toEqual({
      target: "outbound",
      route: "POST api.stripe.com/v1/checkout/sessions",
      fault: { kind: "status", status: 500 },
      nth: 1,
      label: "status 500 on POST api.stripe.com/v1/checkout/sessions",
    })
    expect(
      parseFault("reset-after on GET checkout.stripe.com/checkout/cs_test_a1B2c3D4e5 #2"),
    ).toMatchObject({
      route: "GET checkout.stripe.com/checkout/:id",
      fault: { kind: "reset-after" },
      nth: 2,
    })
  })

  it("reads webhook faults, with or without a service", () => {
    expect(parseFault("duplicate on webhook checkout.session.completed")).toMatchObject({
      target: "webhook",
      topic: "checkout.session.completed",
      fault: { kind: "duplicate" },
    })
    expect(
      parseFault("stale 3600s on google webhook pubsub:projects/p/subscriptions/s"),
    ).toMatchObject({
      service: "google",
      topic: "pubsub:projects/p/subscriptions/s",
      fault: { kind: "stale", seconds: 3600 },
    })
  })

  it("reads the race faults a live session can arm: a slow call and a reorder", () => {
    expect(
      parseFault("slow-then-retry 3000ms on POST api.stripe.com/v1/checkout/sessions"),
    ).toMatchObject({ target: "outbound", fault: { kind: "slow-then-retry", ms: 3000 }, nth: 1 })
    expect(parseFault("reorder webhooks payment_intent.created, payment_intent.succeeded")).toEqual(
      {
        target: "webhook",
        topic: "payment_intent.created",
        fault: { kind: "after", topic: "payment_intent.succeeded" },
        nth: 1,
        label: "reorder webhooks payment_intent.created, payment_intent.succeeded",
      },
    )
    expect(parseFault("reorder stripe webhooks a.b, c.d #2")).toMatchObject({
      service: "stripe",
      topic: "a.b",
      nth: 2,
    })
  })

  it("explains the forms it reads when it cannot read one", () => {
    expect(() => parseFault("explode on POST api.stripe.com/x")).toThrow(/status <code> on/)
    expect(() => parseFault("duplicate")).toThrow(/cannot read the fault/)
  })
})

describe("snapshot changes", () => {
  const page = '- heading "Shop" [ref=e1]\n- button "Buy" [ref=e2]'

  it("finds nothing new when only refs changed", () => {
    expect(snapshotChange(page, page.replace("e2", "f1e7"))).toEqual({ kind: "same" })
  })

  it("lists what went and what came", () => {
    const after = '- heading "Shop" [ref=e1]\n- button "Buy" [ref=e2]\n- status "Added" [ref=e3]'

    expect(snapshotChange(page, after)).toEqual({
      kind: "diff",
      lines: ['+ - status "Added" [ref=e3]'],
    })
  })

  it("answers with the whole page when most of it changed", () => {
    expect(snapshotChange(page, '- heading "Thanks" [ref=e9]')).toEqual({ kind: "whole" })
  })
})

describe("danwo init", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-init-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("creates the three client configs, then leaves them alone", async () => {
    const first = await initProject({ cwd: dir, skill: false })

    expect(first.map((change) => change.outcome)).toEqual(["created", "created", "created"])
    expect(JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { danwo: { command: "npx", args: ["@danwo/cli", "mcp"] } },
    })
    expect(await readFile(join(dir, ".codex/config.toml"), "utf8")).toBe(
      '[mcp_servers.danwo]\ncommand = "npx"\nargs = ["@danwo/cli","mcp"]\n',
    )
    expect(initReport(await initProject({ cwd: dir, skill: false }))).toBe(
      "unchanged .mcp.json\nunchanged .cursor/mcp.json\nunchanged .codex/config.toml",
    )
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

    const changes = await initProject({ cwd: dir, starterConfig: true, skill: false })

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

    const changes = await initProject({ cwd: dir, clients: [".vscode/mcp.json"], skill: false })

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
