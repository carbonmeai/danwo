/*
 * `danwo test` in CI: last-failed reruns, flaky merging, CI defaults, shards and their merge, JUnit,
 * and picking tests by change. Fixtures run under Node, with `CI` cleared unless a test sets it.
 */
import { execFile } from "node:child_process"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url))
const SHOP = fileURLToPath(new URL("../../../examples/shop", import.meta.url))
const exec = promisify(execFile)

interface Ran {
  readonly code: number
  readonly out: string
}

function hasOutput(error: unknown): error is { code: number; stdout: string; stderr: string } {
  return typeof error === "object" && error !== null && "stdout" in error && "code" in error
}

/** `danwo <args>` in `cwd`, never throwing: the exit code and both streams together. */
async function cli(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<Ran> {
  const options = { cwd, env: { ...process.env, NO_COLOR: "1", CI: "", ...env } }

  try {
    const { stdout, stderr } = await exec(process.execPath, [BIN, ...args], options)

    return { code: 0, out: stdout + stderr }
  } catch (error) {
    if (!hasOutput(error)) throw error

    return { code: error.code, out: error.stdout + error.stderr }
  }
}

const ci = join(FIXTURES, "ci")

afterAll(async () => {
  for (const dir of [ci, join(FIXTURES, "ci-only"), join(FIXTURES, "basic"), SHOP])
    await rm(join(dir, ".danwo"), { recursive: true, force: true })
})

describe("danwo test in CI", () => {
  it("reruns only what failed, and reports a test that then passed as flaky", async () => {
    const first = await cli(ci, ["test"], { CI_FIXTURE_FAIL: "1" })

    expect(first.code).toBe(1)
    expect(first.out).toContain("2 passed, 1 failed")

    const again = await cli(ci, ["test", "--last-failed"])

    expect(again.code).toBe(0)
    expect(again.out).toContain("Running 1 test with 1 worker")
    expect(again.out).toContain(
      "~ flaky: tests/b.danwo.ts › b fails when told to (passed on attempt 2)",
    )
    expect(again.out).toContain("2 passed, 1 flaky")

    const nothing = await cli(ci, ["test", "--last-failed"])

    expect(nothing).toEqual({ code: 0, out: "No tests failed in the last run.\n" })
  }, 120_000)

  it("refuses .only in CI, naming the file and line", async () => {
    const { code, out } = await cli(join(FIXTURES, "ci-only"), ["test"], { CI: "true" })

    expect(code).toBe(2)
    expect(out).toContain("tests/focused.danwo.ts:3")
  }, 60_000)

  it("retries once by default in CI, so a test that passes on its retry reads as flaky", async () => {
    const { code, out } = await cli(join(FIXTURES, "basic"), ["test", "flaky"], {
      CI: "true",
      DANWO_FIXTURE_STATE: await mkdtemp(join(tmpdir(), "danwo-ci-state-")),
    })

    expect(code).toBe(0)
    expect(out).toContain(
      "CI: retries default to 1, the replay cache is read-only, .only is refused",
    )
    expect(out).toContain("1 flaky")
  }, 120_000)

  it("stops starting test files once --max-failures tests failed", async () => {
    const { code, out } = await cli(ci, ["test", "--max-failures", "1"], { CI_FIXTURE_FAIL: "1" })

    expect(code).toBe(1)
    expect(out).toContain("stopped after 1 failed: 1 test files not run")
  }, 120_000)

  it("splits the suite with --shard and joins the shards into one JUnit report", async () => {
    const one = await cli(ci, ["test", "--shard", "1/2"])
    const two = await cli(ci, ["test", "--shard", "2/2"])

    expect(one.out).toContain("Running 2 tests")
    expect(two.out).toContain("Running 1 test")

    const merged = await cli(ci, ["merge-reports", "--reporter", "junit"])
    const xml = await readFile(join(ci, ".danwo", "junit.xml"), "utf8")

    expect(merged.code).toBe(0)
    expect(merged.out).toContain("merged 2 result files")
    expect(merged.out).toContain("3 passed")
    expect(xml.match(/<testcase /g)).toHaveLength(3)
  }, 120_000)
})

/** Runs `git` in `cwd` as a throwaway committer. */
function git(cwd: string, args: readonly string[]) {
  return exec("git", ["-c", "user.name=danwo", "-c", "user.email=danwo@danwo.test", ...args], {
    cwd,
  })
}

describe("danwo test --changed", () => {
  it("runs the tests a change can affect: imports, rules, everything, or nothing", async () => {
    // Inside the fixtures, so the copy resolves @danwo/sdk and the shared page server.
    const work = await mkdtemp(join(FIXTURES, ".work-changed-"))

    try {
      await cp(ci, work, { recursive: true })
      await git(work, ["init", "-q"])
      await git(work, ["add", "."])
      await git(work, ["commit", "-q", "-m", "fixture"])
      expect((await cli(work, ["test"])).code).toBe(0)

      await writeFile(join(work, "lib", "heading.ts"), "export const HEADING = /^Worker \\d+$/\n")

      const helper = await cli(work, ["test", "--changed"])

      expect(helper.out).toContain("selected: 1 of 3 tests")
      expect(helper.out).toContain("the test imports lib/heading.ts")
      expect(helper.out).toContain("Running 1 test")

      await git(work, ["commit", "-qam", "heading"])
      await writeFile(join(work, "README.md"), "# fixture\n")

      expect(await cli(work, ["test", "--changed"])).toMatchObject({ code: 0 })
      expect((await cli(work, ["test", "--changed"])).out).toContain(
        "No tests are affected by the change.",
      )

      await writeFile(join(work, "package.json"), "{}\n")

      const unmapped = await cli(work, ["test", "--changed"])

      expect(unmapped.out).toContain("unmapped: package.json (selects every test)")
      expect(unmapped.out).toContain("Running 3 tests")
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }, 180_000)

  it("on the shop, a webhook handler change selects the buy-credits test and its matrix", async () => {
    expect((await cli(SHOP, ["test"])).code).toBe(0)

    const webhook = await cli(SHOP, ["impact", "src/webhooks.ts"])

    expect(webhook.out).toContain("selected: 1 of 2 tests")
    expect(webhook.out).toContain(
      "tests/buy-credits.danwo.ts › buys 500 credits through Stripe Checkout",
    )
    expect(webhook.out).toContain(
      "src/webhooks.ts (src/webhooks.ts) → webhook checkout.session.completed",
    )
    expect(webhook.out).toContain("matrix: danwo matrix tests/buy-credits.danwo.ts")

    const readme = await cli(SHOP, ["impact", "README.md"])

    expect(readme.out).toContain("ignored: README.md (no test depends on it)")
    expect(readme.out).toContain("selected: 0 of 2 tests")
  }, 180_000)
})
