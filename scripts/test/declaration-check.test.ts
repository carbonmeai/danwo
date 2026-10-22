import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, describe, expect, test } from "vitest"

import {
  declarationOf,
  type Manifest,
  manifestProblems,
  unresolvableImports,
} from "../declaration-check.ts"

const ENTRY = {
  "danwo-source": "./src/index.ts",
  types: "./dist/types/index.d.ts",
  default: "./src/index.ts",
}

const made: string[] = []

/** A package folder holding `files` (path to contents), removed after the test. */
function packageWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "danwo-declarations-"))

  made.push(dir)

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }

  return dir
}

afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("manifestProblems", () => {
  test("accepts exports that read the source first, then the declarations", () => {
    const manifest: Manifest = {
      name: "@danwo/a",
      files: ["src", "dist/types", "NOTICE"],
      exports: { ".": ENTRY, "./strip-types": "./strip-types.mjs" },
    }

    expect(manifestProblems(manifest)).toEqual([])
  })

  test("names an export without types, conditions out of order and what files leaves out", () => {
    const manifest: Manifest = {
      name: "@danwo/a",
      files: ["src"],
      exports: {
        ".": "./src/index.ts",
        "./b": {
          types: "./dist/types/b.d.ts",
          "danwo-source": "./src/b.ts",
          default: "./src/b.ts",
        },
        "./c": { ...ENTRY, types: "./dist/c.d.ts" },
      },
    }

    expect(manifestProblems(manifest)).toEqual([
      '@danwo/a: "files" leaves out "dist/types"',
      '@danwo/a: "files" leaves out "NOTICE"',
      '@danwo/a: exports "." without a "types" condition',
      '@danwo/a: exports "./b": list "danwo-source", then "types", first',
      '@danwo/a: exports "./c": "types" should be ./dist/types/index.d.ts',
    ])
  })

  test("maps a source file to its declarations", () => {
    expect(declarationOf("./src/runner/index.ts")).toBe("./dist/types/runner/index.d.ts")
  })
})

describe("unresolvableImports", () => {
  const manifest: Manifest = {
    name: "@danwo/a",
    exports: { ".": ENTRY },
    dependencies: { typed: "1.0.0", untyped: "1.0.0" },
  }

  test("follows the exports' declarations and names imports a user can't resolve", () => {
    const dir = packageWith({
      "dist/types/index.d.ts": [
        '/** Mentions `import { x } from "commented"` in a comment. */',
        'import type { Server } from "node:http";',
        'export type { Inner } from "./inner.ts";',
        'export declare const typed: import("typed").Typed;',
        'export type Words = "from" | "to";',
      ].join("\n"),
      "dist/types/inner.d.ts": 'import type Stripe from "stripe";\nexport type Inner = Stripe;',
      "dist/types/unreached.d.ts": 'import type { X } from "unreached";',
      "node_modules/typed/package.json": JSON.stringify({ name: "typed", types: "index.d.ts" }),
    })

    expect(unresolvableImports(dir, manifest)).toEqual([
      "@danwo/a: dist/types/inner.d.ts imports stripe, which is not among its dependencies",
    ])
  })

  test("names a dependency whose types live in an @types package it doesn't depend on", () => {
    const dir = packageWith({
      "dist/types/index.d.ts": 'import type { U } from "untyped";\nexport type T = U;',
      "node_modules/untyped/package.json": JSON.stringify({ name: "untyped" }),
    })

    expect(unresolvableImports(dir, manifest)).toEqual([
      "@danwo/a: dist/types/index.d.ts imports untyped, whose types are in @types/untyped, which is not among its dependencies",
    ])
    expect(
      unresolvableImports(dir, {
        ...manifest,
        dependencies: { ...manifest.dependencies, "@types/untyped": "1.0.0" },
      }),
    ).toEqual([])
  })

  test("names declarations that were not emitted", () => {
    const dir = packageWith({ "dist/types/index.d.ts": 'export * from "./gone.ts";' })

    expect(unresolvableImports(dir, manifest)).toEqual([
      "@danwo/a: dist/types/index.d.ts imports ./gone.ts, which was not emitted",
    ])
    expect(unresolvableImports(packageWith({}), manifest)).toEqual([
      "@danwo/a: dist/types/index.d.ts, which its exports name, was not emitted",
    ])
  })
})
