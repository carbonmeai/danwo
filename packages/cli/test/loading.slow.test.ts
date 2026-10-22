/**
 * What `danwo test` makes of a project's own files before and around its tests: config keys it
 * does not know, TypeScript that type stripping cannot load, aliases from tsconfig paths, and
 * afterAll hooks that must run however the file's setup went.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url))
const made: string[] = []

afterAll(async () => {
  await Promise.all(
    made.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  )
})

/** A project inside the repository (so it resolves @danwo/sdk as an installed one would). */
async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(FIXTURES, ".loading-"))

  made.push(root)

  for (const [file, text] of Object.entries({
    "package.json": JSON.stringify({ name: "loading", type: "module" }),
    ...files,
  })) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), text)
  }

  return root
}

/** Runs `danwo <args>` in `cwd`; resolves to its exit code, stdout and stderr. */
function danwo(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", CI: "" } },
      (error, stdout, stderr) => {
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          out: stdout,
          err: stderr,
        })
      },
    )
  })
}

const A_TEST = `import { test } from "@danwo/sdk"

test("one", async ({ expect }) => {
  expect(1).toBe(1)
})
`

describe("the config", () => {
  it("warns of each key danwo does not know, on stderr, with the key it likely means", async () => {
    const root = await project({
      "danwo.config.ts": 'export default { testDir: "tests", retires: 2 }\n',
      "tests/a.danwo.ts": A_TEST,
    })
    const listed = await danwo(root, ["test", "--list"])

    expect(listed.code).toBe(0)
    expect(listed.err).toContain(
      "danwo: warning: unknown config key `retires` (did you mean `retries`?); danwo ignores it",
    )
    expect(JSON.parse(listed.out)).toHaveLength(1)
  })
})

describe("test files", () => {
  it("import helpers by tsconfig paths and without extensions", async () => {
    const root = await project({
      "danwo.config.ts": 'export default { testDir: "tests" }\n',
      "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./lib/*"] } } }\n',
      "lib/plans.ts": 'export const PRO: string = "pro"\n',
      "lib/ids.ts": "export const ID: number = 7\n",
      "tests/a.danwo.ts": `import { test } from "@danwo/sdk"

import { PRO } from "@/plans"
import { ID } from "../lib/ids"

test(\`\${PRO} \${ID}\`, async () => {})
`,
    })
    const listed = await danwo(root, ["test", "--list"])

    expect(listed.err).toBe("")
    expect(listed.out).toContain("tests/a.danwo.ts › pro 7")
  })

  it("stop the run before any test, naming an enum and what to write instead", async () => {
    const root = await project({
      "danwo.config.ts": 'export default { testDir: "tests" }\n',
      "tests/a.danwo.ts": `import { test } from "@danwo/sdk"

enum Plan { Free, Pro }

test("one", async () => {})
`,
    })
    const run = await danwo(root, ["test"])

    expect(run.code).toBe(2)
    expect(run.err).toContain("tests/a.danwo.ts:3: an `enum` cannot load in the test file")
    expect(run.err).toContain("use a plain object with `as const`")
  })
})

describe("afterAll", () => {
  it("still runs every hook when a beforeAll throws, and the file names the failures", async () => {
    const root = await project({
      "danwo.config.ts": 'export default { testDir: "tests" }\n',
      "tests/a.danwo.ts": `import { writeFileSync } from "node:fs"

import { test } from "@danwo/sdk"

test.beforeAll(async () => {
  throw new Error("seeding failed")
})

test.afterAll(async () => {
  throw new Error("first cleanup failed")
})

test.afterAll(async () => {
  writeFileSync(new URL("../cleaned.txt", import.meta.url), "yes")
})

test("one", async () => {})
`,
    })
    const run = await danwo(root, ["test"])

    expect(run.code).not.toBe(0)
    expect(`${run.out}${run.err}`).toContain(
      "seeding failed (afterAll also failed: first cleanup failed)",
    )
    expect(existsSync(join(root, "cleaned.txt"))).toBe(true)
  })
})

describe("--max-duration", () => {
  it("starts no file once the run is out of time, and fails the run for the files left out", async () => {
    const root = await project({
      "danwo.config.ts": 'export default { testDir: "tests" }\n',
      "tests/a.danwo.ts": A_TEST,
      "tests/b.danwo.ts": A_TEST,
    })
    const run = await danwo(root, ["test", "--max-duration", "1ms"])

    expect(run.out).toContain("stopped at --max-duration (0 s): 2 test files not run")
    expect(run.code).toBe(1)
  })
})

/** Two tests that take a while and share nothing. */
const SLOW_TESTS = `import { test } from "@danwo/sdk"

test("one", async () => {
  await new Promise((resolve) => setTimeout(resolve, 1_500))
})

test("two", async () => {
  await new Promise((resolve) => setTimeout(resolve, 1_500))
})
`

/** Two tests after a beforeAll that notes each time it runs. */
const SHARED_TESTS = `import { appendFileSync } from "node:fs"

import { test } from "@danwo/sdk"

test.beforeAll(async () => {
  appendFileSync(new URL("../setup-runs.txt", import.meta.url), "ran\\n")
})

test("signs up", async () => {})

test("then pays", async () => {})
`

describe("--split-files", () => {
  it("runs a file's tests on separate workers when they share nothing, and keeps a file with a beforeAll whole", async () => {
    const root = await project({
      "danwo.config.ts": 'export default { testDir: "tests", baseUrl: "http://127.0.0.1:9" }\n',
      "tests/a-slow.danwo.ts": SLOW_TESTS,
      "tests/b-shared.danwo.ts": SHARED_TESTS,
    })
    const run = await danwo(root, ["test", "--split-files", "-w", "2"])
    const results: { reports: { id: string; status: string; workerIndex: number }[] } = JSON.parse(
      await readFile(join(root, ".danwo", "results", "last-run.json"), "utf8"),
    )
    const worker = (title: string) =>
      results.reports.find((report) => report.id.endsWith(title))?.workerIndex

    expect(run.code, `${run.out}${run.err}`).toBe(0)
    expect(results.reports.map((report) => report.status)).toEqual(Array(4).fill("passed"))
    expect(worker("› one")).not.toBe(worker("› two"))
    expect(worker("› signs up")).toBe(worker("› then pays"))
    expect(await readFile(join(root, "setup-runs.txt"), "utf8")).toBe("ran\n")
  })
})
