import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { bunPreloadOption, nodeImportOption } from "../src/node-env.ts"

let root: string
let preload: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo preload "))
  /* A space and an apostrophe, as in `/Users/Jane O'Neil/…`. */
  const dir = join(root, "Jane O'Neil")

  await mkdir(dir)
  preload = join(dir, "preload.mjs")
  await writeFile(preload, 'globalThis.danwoPreloaded = "yes"\n')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function hasBun(): boolean {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" })

    return true
  } catch {
    return false
  }
}

/** What `globalThis.danwoPreloaded` reads in a process started with `env`. */
function preloaded(command: string, env: NodeJS.ProcessEnv): string {
  return execFileSync(command, ["-e", "console.log(String(globalThis.danwoPreloaded))"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).trim()
}

describe("the preload under a path with spaces", () => {
  it("is one NODE_OPTIONS entry that Node imports", () => {
    expect(nodeImportOption(preload)).not.toMatch(/\s/)
    expect(
      preloaded(process.execPath, { NODE_OPTIONS: `--no-warnings ${nodeImportOption(preload)}` }),
    ).toBe("yes")
  })

  it.runIf(hasBun())("is one BUN_OPTIONS entry that Bun preloads, ahead of a bare flag", () => {
    expect(preloaded("bun", { BUN_OPTIONS: `${bunPreloadOption(preload)} --smol` })).toBe("yes")
  })

  it("stays unquoted when the path needs no quotes", () => {
    expect(bunPreloadOption("/srv/app/preload.mjs")).toBe("--preload=/srv/app/preload.mjs")
  })

  it("quotes a Windows path with forward slashes, since Bun reads a quoted backslash as an escape", () => {
    expect(bunPreloadOption(String.raw`C:\Users\Jane Doe\preload.mjs`, "win32")).toBe(
      '"--preload=C:/Users/Jane Doe/preload.mjs"',
    )
  })

  it("escapes a double quote in a POSIX path", () => {
    expect(bunPreloadOption('/srv/a "b"/p.mjs', "linux")).toBe(
      String.raw`"--preload=/srv/a \"b\"/p.mjs"`,
    )
  })
})
