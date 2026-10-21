/**
 * The brand files the site serves, copied from the repository's `brand/` folder into `public/`
 * before Vite starts, so `brand/` stays the one place they are edited. Files are only rewritten
 * when their bytes differ.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

import { REPO_ROOT } from "./danwo.ts"

/** The repository's brand folder. */
export const BRAND_DIR = join(REPO_ROOT, "brand")

/** One brand file and where the site serves it, relative to `public/`. */
export interface BrandCopy {
  readonly from: string
  readonly to: string
}

/** Every brand file the site serves: the SVG and PNG sets under `/brand/`, subfolders included, and the `.ico` at the root. */
export function brandCopies(): BrandCopy[] {
  const folder = (name: string) =>
    readdirSync(join(BRAND_DIR, name), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(join(BRAND_DIR, name), join(entry.parentPath, entry.name)))
      .filter((file) => !file.split(sep).some((part) => part.startsWith(".")))
      .toSorted()
      .map((file) => ({ from: join(BRAND_DIR, name, file), to: join("brand", name, file) }))

  return [
    ...folder("svg"),
    ...folder("png"),
    { from: join(BRAND_DIR, "favicon.ico"), to: "favicon.ico" },
  ]
}

/** Copies the brand files into `publicDir` and returns how many were written. */
export function copyBrand(publicDir: string): number {
  let written = 0

  for (const { from, to } of brandCopies()) {
    const target = join(publicDir, to)
    const bytes = readFileSync(from)

    if (existsSync(target) && readFileSync(target).equals(bytes)) continue

    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    written += 1
  }

  return written
}
