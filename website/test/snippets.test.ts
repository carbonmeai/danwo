/**
 * The code on the pages written for the website compiles: every TypeScript block whose title is
 * a file name (`tests/checkout.danwo.ts`) is written out at that path, with the other files of
 * its page, and type-checked against `@danwo/sdk`. A block titled as part of a file
 * (`danwo.config.ts · the model`) is a fragment and is left out.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { REPO_ROOT } from "../src/generator/danwo.ts"
import { CONTENT, WEBSITE } from "../src/generator/generate.ts"

/** Where the snippets are written while they are checked; git-ignored. */
const OUT = join(WEBSITE, ".snippets")

/** A fenced TypeScript block with a title, anywhere in an MDX file. */
const BLOCK = /^[ \t]*```tsx?[ \t]+title="([^"]+)"[^\n]*\n([\s\S]*?)^[ \t]*```/gm

/** Every MDX file under `dir`. */
function mdxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) return mdxFiles(path)

    return path.endsWith(".mdx") ? [path] : []
  })
}

/** The complete files a page shows, by the path in their titles. */
function snippetsOf(text: string): Map<string, string> {
  const files = new Map<string, string>()

  for (const [, title = "", code = ""] of text.matchAll(BLOCK)) {
    if (!/\.tsx?$/.test(title)) continue
    if (files.has(title)) throw new Error(`two blocks titled ${title} on one page`)

    files.set(title, code)
  }

  return files
}

/** Writes each page's files under its own folder and a tsconfig over them all. */
function writeSnippets(): number {
  rmSync(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

  let count = 0

  for (const page of mdxFiles(CONTENT)) {
    const folder = join(OUT, relative(CONTENT, page).replace(/\.mdx$/, ""))

    for (const [path, code] of snippetsOf(readFileSync(page, "utf8"))) {
      const target = join(folder, path)

      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, code)
      count += 1
    }
  }

  const config = {
    extends: relative(OUT, join(REPO_ROOT, "tsconfig.base.json")),
    include: ["**/*.ts", "**/*.tsx"],
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`)

  return count
}

afterAll(() => rmSync(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe("the code on the docs pages", () => {
  it("type-checks against @danwo/sdk", () => {
    expect(writeSnippets()).toBeGreaterThan(5)

    /* TypeScript's own script under Node: `.bin/tsc` is a `.cmd` file on Windows. */
    const tsc = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", OUT],
      { encoding: "utf8" },
    )

    expect(`${tsc.stdout}${tsc.stderr}`.trim()).toBe("")
    expect(tsc.status).toBe(0)
  }, 120_000)
})
