/**
 * Builds the type declarations danwo's published packages ship, and checks a user's TypeScript can
 * read them.
 *
 * The packages run from their `.ts` source, but a project that type-checks its tests would follow
 * those imports into danwo's source and check it with its own options and without danwo's
 * development dependencies. So each package's `exports` sends TypeScript to declarations in
 * `dist/types` instead (the `types` condition), and the repository's own tsconfig reads the source
 * (the `danwo-source` condition, first).
 *
 * One `tsc` run over `tsconfig.declarations.json` writes them; each package's folder is then moved
 * to its `dist/types`, and `declaration-check.ts` fails the build when an export misses its
 * declarations or they import a package the user won't have.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { manifestProblems, readManifest, unresolvableImports } from "./declaration-check.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const CONFIG = "tsconfig.declarations.json"
const EMITTED = join(ROOT, ".types")

/** The package folders the declaration build covers, named by what its `include` lists. */
function packagesBuilt(): string[] {
  const config: unknown = JSON.parse(readFileSync(join(ROOT, CONFIG), "utf8"))
  const include: unknown = Reflect.get(Object(config), "include")
  const entries = Array.isArray(include) ? include.filter((e) => typeof e === "string") : []
  const names = entries.map((entry) => /^packages\/([^/]+)\//.exec(entry)?.[1])

  return [...new Set(names.filter((name) => name !== undefined))]
}

rmSync(EMITTED, { recursive: true, force: true })
execFileSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", CONFIG], {
  cwd: ROOT,
  stdio: "inherit",
})

const problems: string[] = []

for (const folder of packagesBuilt()) {
  const dir = join(ROOT, "packages", folder)
  const target = join(dir, "dist", "types")
  const manifest = readManifest(join(dir, "package.json"))

  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  renameSync(join(EMITTED, folder, "src"), target)
  problems.push(...manifestProblems(manifest), ...unresolvableImports(dir, manifest))
}

rmSync(EMITTED, { recursive: true, force: true })

if (problems.length > 0) {
  console.error(`The declarations would not type-check for a user:\n  ${problems.join("\n  ")}`)
  process.exitCode = 1
}
