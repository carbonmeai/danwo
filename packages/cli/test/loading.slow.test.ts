/**
 * What `danwo test` makes of a project's own files before and around its tests: config keys it
 * does not know, TypeScript that type stripping cannot load, aliases from tsconfig paths, and
 * afterAll hooks that must run however the file's setup went.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url))
const made: string[] = []

afterAll(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })))
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
