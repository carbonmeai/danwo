import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { BRAND_DIR, brandCopies, copyBrand } from "../src/generator/brand.ts"

const SOURCES = ["svg", "png"].flatMap((folder) =>
  readdirSync(join(BRAND_DIR, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => join(entry.parentPath, entry.name)),
)

/** Every `/brand/…` or root icon path the site's code and manifest refer to. */
function referencedPaths(): string[] {
  const files = [
    join(import.meta.dirname, "..", "src", "components", "brand.tsx"),
    join(import.meta.dirname, "..", "src", "routes", "__root.tsx"),
    join(import.meta.dirname, "..", "public", "site.webmanifest"),
  ]
  const text = files.map((file) => readFileSync(file, "utf8")).join("\n")
  const inline = [...text.matchAll(/\/brand\/(svg|png)\/[\w@.-]+\.(?:svg|png)/g)].map((m) => m[0])
  const templated = [...text.matchAll(/\$\{BRAND\}\/([\w@.-]+\.svg)/g)].map(
    (m) => `/brand/svg/${m[1]}`,
  )

  return [...new Set([...inline, ...templated])]
}

let out: string | undefined

afterEach(() => {
  if (out) rmSync(out, { recursive: true, force: true })
  out = undefined
})

describe("brand files", () => {
  it("copies every file in brand/ byte for byte, and only rewrites what changed", () => {
    out = mkdtempSync(join(tmpdir(), "danwo-brand-"))

    expect(copyBrand(out)).toBe(brandCopies().length)
    expect(brandCopies().length).toBe(SOURCES.length + 1)

    for (const { from, to } of brandCopies())
      expect(readFileSync(join(out, to)).equals(readFileSync(from))).toBe(true)

    expect(copyBrand(out)).toBe(0)
  })

  it("only refers to brand files that exist", () => {
    const paths = referencedPaths()

    expect(paths.length).toBeGreaterThan(4)

    for (const path of paths)
      expect(existsSync(join(BRAND_DIR, path.replace(/^\/brand\//, "")))).toBe(true)
  })
})
