/**
 * What every published package carries beside its code: the repository's LICENSE, a NOTICE for the
 * package, and a README when the package has none of its own, pointing to danwo.dev. Run from the
 * package's folder: `add` before packing (`prepack`) copies them in, `remove` after it (`postpack`)
 * deletes them again, but only files that are exactly what `add` writes, so a package's own README
 * stays.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const PACKAGE = process.cwd()

interface Manifest {
  readonly name: string
  readonly description?: string
}

/** The README of a package that has none: what it is, and where danwo is documented. */
function readme(manifest: Manifest): string {
  const folder = basename(PACKAGE)

  return [
    `# ${manifest.name}`,
    "",
    ...(manifest.description ? [manifest.description, ""] : []),
    "Part of [dánwò](https://danwo.dev), an open-source testing framework that drives your app",
    "through its UI like a user, then checks everything that happened behind it. Most projects",
    "get it through `@danwo/cli` and import `@danwo/sdk` in their tests:",
    "",
    "```sh",
    "npx @danwo/cli init",
    "```",
    "",
    `Documentation: https://danwo.dev. Source: https://github.com/carbonmeai/danwo/tree/main/packages/${folder}.`,
    "Licensed under the Apache License 2.0.",
    "",
  ].join("\n")
}

/**
 * The NOTICE a package ships. The repository's NOTICE also covers the brand files and the
 * wordmark's font, which no package holds, so a package gets only what applies to its code.
 */
const PACKAGE_NOTICE = [
  "dánwò (danwo)",
  "Copyright 2026 Carbonme Inc",
  "",
  "This product is licensed under the Apache License, Version 2.0 (see LICENSE).",
  "",
].join("\n")

/** The files `add` writes into the package, with their contents. */
function packFiles(): Map<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8"))
  const name: unknown = Reflect.get(Object(parsed), "name")
  const description: unknown = Reflect.get(Object(parsed), "description")
  const manifest: Manifest = {
    name: typeof name === "string" ? name : basename(PACKAGE),
    ...(typeof description === "string" && { description }),
  }
  const files = new Map<string, string>()

  files.set("LICENSE", readFileSync(join(ROOT, "LICENSE"), "utf8"))
  files.set("NOTICE", PACKAGE_NOTICE)
  files.set("README.md", readme(manifest))

  return files
}

const action = process.argv[2]

if (action === "add") {
  for (const [name, text] of packFiles())
    if (!existsSync(join(PACKAGE, name))) writeFileSync(join(PACKAGE, name), text)
} else if (action === "remove") {
  for (const [name, text] of packFiles()) {
    const file = join(PACKAGE, name)

    if (existsSync(file) && readFileSync(file, "utf8") === text) rmSync(file)
  }
} else {
  console.error("usage: node scripts/pack-files.ts add|remove (from a package's folder)")
  process.exitCode = 1
}
