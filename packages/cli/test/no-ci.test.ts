import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))

let project: string

/** `danwo test --list` in the project with `CI=true`, as a job's step and its children see it. */
function listInCi(...flags: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, "test", "--list", ...flags],
      { cwd: project, env: { ...process.env, CI: "true", NO_COLOR: "1" } },
      (error, stdout, stderr) =>
        resolve({ code: Number(error?.code ?? 0), output: `${stdout}${stderr}` }),
    )
  })
}

/* Inside the package, so the test file resolves `@danwo/sdk`. */
beforeAll(async () => {
  project = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), ".no-ci-"))
  await mkdir(join(project, "tests"))
  await writeFile(join(project, "danwo.config.ts"), "export default {}\n")
  await writeFile(
    join(project, "tests", "focused.danwo.ts"),
    'import { test } from "@danwo/sdk"\n\ntest.only("one", async () => {})\ntest("two", async () => {})\n',
  )
})

afterAll(() => rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe("danwo test --no-ci", () => {
  it("keeps local defaults with CI set, so a run started from inside a CI job allows .only", async () => {
    const ci = await listInCi()
    const local = await listInCi("--no-ci")

    expect(ci.code, ci.output).toBe(2)
    expect(ci.output).toContain(".only")
    expect(local.code, local.output).toBe(0)
    expect(JSON.parse(local.output)).toMatchObject([{ id: "tests/focused.danwo.ts › one" }])
  }, 60_000)
})
