/**
 * Whether a package's built declarations will type-check for its users: its `exports` send
 * TypeScript to them, `files` ships them, and nothing they import is missing from a user's install.
 * `scripts/declarations.ts` runs these checks after each build.
 */
import { existsSync, readFileSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, relative, resolve } from "node:path"

/** The condition the repository's own tsconfig resolves first, to read the source. */
const SOURCE_CONDITION = "danwo-source"

/** What every package that ships declarations lists in `files`. NOTICE is copied in when packing. */
const SHIPPED = ["dist/types", "NOTICE"]

const BUILTINS = new Set(builtinModules)

type ExportTarget = string | Readonly<Record<string, string>>

/** The parts of a package.json the checks read. */
export interface Manifest {
  readonly name: string
  readonly files?: readonly string[]
  readonly exports?: Readonly<Record<string, ExportTarget>>
  readonly types?: string
  readonly typings?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

/** Whether parsed JSON looks like a package.json: an object with a `name`. */
function isManifest(value: unknown): value is Manifest {
  return typeof Reflect.get(Object(value), "name") === "string"
}

/** The package.json at `file`. */
export function readManifest(file: string): Manifest {
  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"))

  if (!isManifest(manifest)) throw new Error(`${file} has no "name"`)

  return manifest
}

/** Where the declarations for a source file under `src/` land. */
export function declarationOf(source: string): string {
  return source.replace(/^\.\/src\//, "./dist/types/").replace(/\.ts$/, ".d.ts")
}

/** What is wrong with one `exports` entry, if anything. */
function exportProblem(path: string, target: ExportTarget): string | undefined {
  if (typeof target === "string")
    return target.endsWith(".ts") ? `exports "${path}" without a "types" condition` : undefined

  const source = target[SOURCE_CONDITION]
  const [first, second] = Object.keys(target)

  if (source === undefined || first !== SOURCE_CONDITION || second !== "types")
    return `exports "${path}": list "${SOURCE_CONDITION}", then "types", first`

  return target.types === declarationOf(source)
    ? undefined
    : `exports "${path}": "types" should be ${declarationOf(source)}`
}

/** What is wrong with a package's `exports` and `files`, given where its declarations land. */
export function manifestProblems(manifest: Manifest): string[] {
  const missing = SHIPPED.filter((entry) => !manifest.files?.includes(entry)).map(
    (entry) => `"files" leaves out "${entry}"`,
  )
  const exports = Object.entries(manifest.exports ?? {}).map(([path, target]) =>
    exportProblem(path, target),
  )

  return [...missing, ...exports]
    .filter((problem) => problem !== undefined)
    .map((problem) => `${manifest.name}: ${problem}`)
}

/** The module specifiers a declaration file imports, leaving out what its comments mention. */
function specifiersIn(file: string): string[] {
  const text = readFileSync(file, "utf8")
  const references = [...text.matchAll(/^\/\/\/\s*<reference\s+types="([^"]+)"/gm)]
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const imports = [...code.matchAll(/(?:(?<!")\bfrom\s+|\bimport\(|^\s*import\s+)"([^"]+)"/gm)]

  return [...references, ...imports].map((match) => match[1] ?? "")
}

/** The declaration file a relative specifier names, if it was emitted. */
function localFile(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier)
  const candidates = [
    base.replace(/\.[cm]?[jt]s$/, ".d.ts"),
    `${base}.d.ts`,
    join(base, "index.d.ts"),
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/")

  return parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/")
}

/** The folder of the installed package `name`, as code in `from` would find it. */
function installed(from: string, name: string): string | undefined {
  const folder = join(from, "node_modules", name)

  if (existsSync(join(folder, "package.json"))) return folder

  return dirname(from) === from ? undefined : installed(dirname(from), name)
}

/** Whether the package installed in `folder` carries its own types. */
function hasOwnTypes(folder: string): boolean {
  const manifest = readManifest(join(folder, "package.json"))
  const declared = [manifest.types, manifest.typings].some((field) => field !== undefined)

  return (
    declared ||
    JSON.stringify(manifest.exports ?? {}).includes('"types"') ||
    existsSync(join(folder, "index.d.ts"))
  )
}

/** `@types/name` for `name`, `@types/scope__name` for `@scope/name`. */
function typesPackage(name: string): string {
  return `@types/${name.replace(/^@/, "").replace("/", "__")}`
}

/** Whether a user who installs the package in `dir` gets types for its dependency `name`. */
function typesInstalled(dir: string, name: string, dependencies: Record<string, string>): boolean {
  const folder = installed(dir, name)

  return folder === undefined || hasOwnTypes(folder) || typesPackage(name) in dependencies
}

/** Why a user of the package in `dir` could not resolve `specifier`, if they couldn't. */
function missingFor(dir: string, manifest: Manifest, specifier: string): string | undefined {
  const name = packageName(specifier)
  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies }

  if (specifier.startsWith("node:") || BUILTINS.has(name) || name === manifest.name)
    return undefined

  if (!(name in dependencies)) return `${specifier}, which is not among its dependencies`

  return typesInstalled(dir, name, dependencies)
    ? undefined
    : `${specifier}, whose types are in ${typesPackage(name)}, which is not among its dependencies`
}

/** What a declaration file imports that a user can't resolve, and the local files it reads. */
function importsOf(
  file: string,
  dir: string,
  manifest: Manifest,
): { readonly problems: string[]; readonly next: string[] } {
  const problems: string[] = []
  const next: string[] = []

  for (const specifier of specifiersIn(file)) {
    const local = specifier.startsWith(".") ? localFile(file, specifier) : undefined
    const problem = specifier.startsWith(".")
      ? local === undefined && `${specifier}, which was not emitted`
      : missingFor(dir, manifest, specifier)

    if (local !== undefined) next.push(local)

    if (problem) problems.push(`${relative(dir, file)} imports ${problem}`)
  }

  return { problems, next }
}

/**
 * The imports in the declarations of the package in `dir`, reachable from its exports, that its
 * users can't resolve: packages that are not its dependencies, or dependencies without types.
 */
export function unresolvableImports(dir: string, manifest: Manifest): string[] {
  const queue = Object.values(manifest.exports ?? {}).flatMap((target) =>
    typeof target === "string" || target.types === undefined ? [] : [join(dir, target.types)],
  )
  const seen = new Set<string>()
  const problems = queue
    .filter((entry) => !existsSync(entry))
    .map(
      (entry) =>
        `${manifest.name}: ${relative(dir, entry)}, which its exports name, was not emitted`,
    )

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !existsSync(file)) continue

    seen.add(file)

    const found = importsOf(file, dir, manifest)

    problems.push(...found.problems.map((problem) => `${manifest.name}: ${problem}`))
    queue.push(...found.next)
  }

  return problems
}
