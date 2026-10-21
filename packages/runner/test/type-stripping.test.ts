/**
 * Config and test files load under Node's own type stripping, as a danwo process loads them: in a
 * Node child with danwo's resolve hook, since vitest would compile them first.
 */
import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { withoutJsonComments } from "../src/runner/tsconfig-paths.ts"

const HOOK = new URL("../src/runner/register.ts", import.meta.url).href
const CONFIG = new URL("../src/runner/config.ts", import.meta.url).href
const CATALOG = new URL("../src/runner/catalog.ts", import.meta.url).href
const root = mkdtempSync(join(tmpdir(), "danwo-stripping-"))

afterAll(() => rmSync(root, { recursive: true, force: true }))

let projects = 0

/** A project folder with `files`, a tsconfig with `@/*` and `~lib` aliases among them. */
function project(files: Readonly<Record<string, string>>): string {
  const dir = join(root, `p${++projects}`)
  const all = {
    "package.json": JSON.stringify({ name: "app", type: "module" }),
    "tsconfig.json": `{
      // comments and trailing commas, as tsconfig files have them
      "extends": "./tsconfig.base.json",
      "compilerOptions": { "paths": { "@/*": ["./src/*"], "~lib": ["./src/lib/index.ts"], }, },
    }`,
    "tsconfig.base.json": `{ "compilerOptions": { "strict": true } }`,
    ...files,
  }

  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }

  return dir
}

/** Runs `script` as an ES module under Node with danwo's hook in `cwd`; its output. */
function node(cwd: string, script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", HOOK, "--input-type=module", "-e", script],
      { cwd },
      (_error, stdout, stderr) => resolve(`${stdout}${stderr}`.trim()),
    )
  })
}

/** Loads the project's config; prints its `answer`, or the error's code and message. */
function loadConfigIn(cwd: string): Promise<string> {
  return node(
    cwd,
    `import { loadConfig } from ${JSON.stringify(CONFIG)}
     loadConfig(process.cwd()).then(
       (loaded) => console.log("answer", loaded.config.answer),
       (error) => console.log(error.code, error.message),
     )`,
  )
}

describe("what a config may import", () => {
  it("resolves extensionless relative imports and tsconfig paths, with or without .ts", async () => {
    const dir = project({
      "danwo.config.ts": `import { one } from "./src/one"
import { two } from "@/two.ts"
import { three } from "@/nested/three"
import { four } from "~lib"

export default { answer: one + two + three + four }
`,
      "src/one.ts": "export const one: number = 1\n",
      "src/two.ts": "export const two: number = 2\n",
      "src/nested/three/index.ts": "export const three: number = 3\n",
      "src/lib/index.ts": "export const four: number = 4\n",
    })

    expect(await loadConfigIn(dir)).toBe("answer 10")
  })

  it("says what an alias no file or package answers is, and how to fix it", async () => {
    const dir = project({ "danwo.config.ts": 'import "@/missing"\n\nexport default {}\n' })
    const out = await loadConfigIn(dir)

    expect(out).toMatch(/^CONFIG_INVALID the config danwo\.config\.ts imports "@\/missing"/)
    expect(out).toContain('nor an alias the nearest tsconfig.json\'s "paths" maps to a file')
  })
})

describe("TypeScript that type stripping cannot load", () => {
  it("names an enum in the config, where it is, and what to write instead", async () => {
    const dir = project({ "danwo.config.ts": "enum Plan { Free }\n\nexport default {}\n" })
    const out = await loadConfigIn(dir)

    expect(out).toContain("CONFIG_INVALID danwo.config.ts:1: an `enum` cannot load in the config")
    expect(out).toContain("use a plain object with `as const`")
  })

  it("names a parameter property in a file the config imports", async () => {
    const dir = project({
      "danwo.config.ts":
        'import { Cart } from "./cart.ts"\n\nexport default { answer: new Cart(1).n }\n',
      "cart.ts": "export class Cart {\n  constructor(public n: number) {}\n}\n",
    })
    const out = await loadConfigIn(dir)

    expect(out).toContain("cart.ts:2: a constructor parameter property")
    expect(out).toContain("declare the field in the class body")
  })

  it("names a namespace in a test file", async () => {
    const dir = project({ "tests/a.danwo.ts": "namespace Shop { export const id = 1 }\n" })
    const out = await node(
      dir,
      `import { loadTestFile } from ${JSON.stringify(CATALOG)}
       loadTestFile(${JSON.stringify(join(dir, "tests/a.danwo.ts"))}).then(
         () => console.log("loaded"),
         (error) => console.log(error.code, error.message),
       )`,
    )

    expect(out).toContain(
      "CONFIG_INVALID tests/a.danwo.ts:1: a `namespace` cannot load in the test file",
    )
  })
})

describe("tsconfig files", () => {
  it("parse with comments and trailing commas, strings left alone", () => {
    const text = '{ "a": "http://x // not a comment", /* gone */ "b": [1, 2,], // gone\n }'

    expect(JSON.parse(withoutJsonComments(text))).toEqual({
      a: "http://x // not a comment",
      b: [1, 2],
    })
  })
})
