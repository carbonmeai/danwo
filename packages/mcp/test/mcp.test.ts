import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { locatorCode } from "@danwo/recorder"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

import { removeWorkCopies } from "../../cli/test/work-copy.ts"
import { Project } from "../src/project.ts"
import { testSource } from "../src/tools/scaffold.ts"
import { connect, PANTRY, resultOf, textOf } from "./client.ts"

// Every run writes into the fixture's copy; the copies go when the file is done.
afterAll(removeWorkCopies)

describe("the server", () => {
  it("offers its tools, resources and prompt", async () => {
    const client = await connect(PANTRY)
    const tools = (await client.listTools()).tools.map((tool) => tool.name).toSorted()
    const resources = (await client.listResources()).resources.map((r) => r.uri).toSorted()
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name)

    expect(tools).toEqual([
      "check",
      "check_locator",
      "clear_faults",
      "click",
      "close_session",
      "deliver_webhooks",
      "drag",
      "emulator_state",
      "exchanges",
      "fill",
      "fill_secret",
      "hover",
      "inject_fault",
      "inspect_page",
      "list_tests",
      "navigate",
      "open_session",
      "press",
      "read_screenshot",
      "run_matrix",
      "run_tests",
      "scaffold_test",
      "screenshot",
      "select",
      "show_run",
      "snapshot",
      "start_recording",
      "stop_recording",
      "upload",
    ])
    expect(resources).toEqual([
      "danwo://config",
      "danwo://guide/ci",
      "danwo://guide/dashboard",
      "danwo://guide/debugging",
      "danwo://guide/email-and-otp",
      "danwo://guide/fidelity",
      "danwo://guide/first-test",
      "danwo://guide/infrastructure",
      "danwo://guide/lint",
      "danwo://guide/llm",
      "danwo://guide/locators-vs-agent",
      "danwo://guide/matrix",
      "danwo://guide/mobile",
      "danwo://guide/playwright",
      "danwo://guide/providers",
      "danwo://guide/secrets",
      "danwo://guide/sessions",
      "danwo://guide/time",
      "danwo://runs/latest",
      "danwo://spec",
    ])
    expect(prompts).toEqual(["write-danwo-test"])
    await client.close()
  })

  it("serves the spec and the guides as resources", async () => {
    const client = await connect(PANTRY)
    const read = async (uri: string) =>
      (await client.readResource({ uri })).contents.map((c) => ("text" in c ? c.text : "")).join("")

    expect(await read("danwo://spec")).toContain("## Error codes [errors]")
    expect(await read("danwo://guide/matrix")).toMatch(/^# Invariants and the fault matrix/)
    await client.close()
  })

  it("lists the tests by file with their mode and invariant", async () => {
    const client = await connect(PANTRY)
    const listed = textOf(await client.callTool({ name: "list_tests", arguments: {} }))

    expect(listed).toContain("4 tests under")
    expect(listed).toContain("tests/basket.danwo.ts\n  adds oats to the basket\n  checks out")
    expect(listed).toContain(
      "tests/pantry.danwo.ts\n  lists the pantry [invariant]\n  restocks later [skip]",
    )
    await client.close()
  }, 30_000)

  it("summarises the config without secret values", async () => {
    const client = await connect(PANTRY)
    const read = await client.readResource({ uri: "danwo://config" })
    const config = read.contents.map((c) => ("text" in c ? c.text : "")).join("")

    expect(config).toContain("tests: tests matching **/*.danwo.ts")
    expect(config).toContain("app: started by the config's environment")
    expect(config).toContain("secrets (pass secret(name)): pantryKey")
    expect(config).not.toContain("pantry-key-0f9a8b7c6d5e")
    await client.close()
  }, 30_000)

  it("walks an agent through writing a test", async () => {
    const client = await connect(PANTRY)
    const prompt = await client.getPrompt({
      name: "write-danwo-test",
      arguments: { goal: "buy oats" },
    })
    const message = prompt.messages[0]?.content

    expect(message?.type === "text" && message.text).toMatch(/^Write a danwo test for: buy oats/)
    await client.close()
  })
})

describe("scaffold_test", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "danwo-mcp-"))
    await writeFile(join(root, "danwo.config.ts"), 'export default { testDir: "e2e" }\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("writes a new test under the testDir and never overwrites it", async () => {
    const client = await connect(root)
    const args = {
      file: "checkout/pay.danwo.ts",
      name: "pays for the basket",
      path: "/basket",
      steps: [
        { kind: "code", text: 'await screen.getByRole("button", { name: "Pay" }).click()' },
        { kind: "assert", text: "the order is confirmed" },
      ],
      invariant: "charged once per order",
    }
    const written = textOf(await client.callTool({ name: "scaffold_test", arguments: args }))
    const path = join(root, "e2e/checkout/pay.danwo.ts")

    expect(written).toContain("wrote e2e/checkout/pay.danwo.ts")
    expect(await readFile(path, "utf8")).toBe(`import { test } from "@danwo/sdk"

test("pays for the basket", async ({ app, agent, screen }) => {
  await app.open("/basket")
  await screen.getByRole("button", { name: "Pay" }).click()
  await agent.assert("the order is confirmed")
}).invariant(async () => {
  /* charged once per order */
  throw new Error("invariant not written yet: charged once per order")
})
`)

    const again = resultOf(await client.callTool({ name: "scaffold_test", arguments: args }))

    expect(again.isError).toBe(true)
    expect(textOf(again)).toContain("already exists")
    await client.close()
  }, 30_000)

  it("refuses to write outside the project", async () => {
    const client = await connect(root)
    const escape = resultOf(
      await client.callTool({
        name: "scaffold_test",
        arguments: { file: "../../escaped.danwo.ts", name: "escapes", steps: [] },
      }),
    )

    expect(escape.isError).toBe(true)
    expect(textOf(escape)).toContain("is outside the project")
    expect(existsSync(join(root, "..", "escaped.danwo.ts"))).toBe(false)
    await client.close()
  }, 30_000)

  it("leaves the invariant out when none is described", () => {
    const source = testSource({ name: "opens", path: "/", steps: [], invariant: undefined })

    expect(source).toBe(
      'import { test } from "@danwo/sdk"\n\ntest("opens", async ({ app }) => {\n  await app.open("/")\n})\n',
    )
  })
})

describe("show_run and read_screenshot", () => {
  it("say when nothing was recorded", async () => {
    const root = await mkdtemp(join(tmpdir(), "danwo-mcp-"))

    try {
      const client = await connect(root)

      expect(textOf(await client.callTool({ name: "show_run", arguments: {} }))).toBe(
        "no recorded runs yet",
      )

      const outside = resultOf(
        await client.callTool({ name: "read_screenshot", arguments: { record: "../../etc" } }),
      )

      expect(outside.isError).toBe(true)
      expect(textOf(outside)).toContain("is outside the project")
      await client.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("paths and locators", () => {
  it("keeps paths inside the project root", () => {
    const project = new Project(PANTRY)

    expect(project.inside("tests/basket.danwo.ts")).toBe(join(PANTRY, "tests/basket.danwo.ts"))
    expect(() => project.inside("../site.ts")).toThrow(/outside the project/)
    expect(() => project.inside("/etc/passwd")).toThrow(/outside the project/)
  })

  it("writes a locator as a test would", () => {
    expect(locatorCode({ by: "role", value: "button", name: "Pay", exact: true })).toBe(
      'screen.getByRole("button", { name: "Pay", exact: true })',
    )
    expect(locatorCode({ by: "testId", value: "total" })).toBe('screen.getByTestId("total")')
    expect(locatorCode({ by: "label", value: "Email", exact: false })).toBe(
      'screen.getByLabel("Email", { exact: false })',
    )
  })
})
