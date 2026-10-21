/**
 * `compilerOptions.paths` for a project's own TypeScript files: the aliases (`@/lib/cart`,
 * `~/helpers`) a project's `tsconfig.json` maps to its folders. Node knows nothing of them, so
 * danwo's resolve hook asks here when a bare specifier from a project file finds no package. Only
 * the nearest `tsconfig.json` (and the configs it `extends` by a relative path) is read.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** What a tsconfig's `paths` come to: the folder targets resolve from, and each pattern's targets. */
interface PathAliases {
  readonly base: string
  /** Longest prefix first, as TypeScript tries them. */
  readonly patterns: readonly (readonly [string, readonly string[]])[]
}

const byFolder = new Map<string, PathAliases | undefined>()

/**
 * `text` with what `skip` says to drop outside strings left out: `skip` gets the text and an index
 * outside any string, and returns how many characters to drop there (0 to keep the one).
 */
function outsideStrings(text: string, skip: (text: string, at: number) => number): string {
  let out = ""
  let inString = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ""

    if (inString) {
      out += char
      if (char === "\\") out += text[++i] ?? ""
      else if (char === '"') inString = false
      continue
    }

    const dropped = skip(text, i)

    if (dropped > 0) {
      i += dropped - 1
      continue
    }

    if (char === '"') inString = true
    out += char
  }

  return out
}

/** How long the comment starting at `at` is, its line's end kept; 0 when none starts there. */
function commentAt(text: string, at: number): number {
  if (text.startsWith("//", at)) {
    const end = text.indexOf("\n", at)

    return (end === -1 ? text.length : end) - at
  }

  if (!text.startsWith("/*", at)) return 0

  const end = text.indexOf("*/", at + 2)

  return (end === -1 ? text.length : end + 2) - at
}

/** `text` without `//` and block comments and trailing commas, which tsconfig files may have. */
export function withoutJsonComments(text: string): string {
  const uncommented = outsideStrings(text, commentAt)

  return outsideStrings(uncommented, (rest, at) =>
    rest[at] === "," && /^\s*[}\]]/.test(rest.slice(at + 1)) ? 1 : 0,
  )
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** A config's `compilerOptions`, merged over those of the configs it extends by relative path. */
function compilerOptionsOf(
  file: string,
  depth = 0,
): { paths?: unknown; pathsFrom?: string; baseUrl?: string } {
  let parsed: Readonly<Record<string, unknown>>

  try {
    parsed = recordOf(JSON.parse(withoutJsonComments(readFileSync(file, "utf8"))))
  } catch {
    return {}
  }

  const extended = parsed["extends"]
  const parent =
    typeof extended === "string" && extended.startsWith(".") && depth < 8
      ? compilerOptionsOf(
          resolve(dirname(file), extended.endsWith(".json") ? extended : `${extended}.json`),
          depth + 1,
        )
      : {}
  const own = recordOf(parsed["compilerOptions"])
  const baseUrl =
    typeof own["baseUrl"] === "string" ? resolve(dirname(file), own["baseUrl"]) : undefined

  return {
    ...parent,
    ...(own["paths"] !== undefined && { paths: own["paths"], pathsFrom: dirname(file) }),
    ...(baseUrl !== undefined && { baseUrl }),
  }
}

/** The part of a `paths` pattern before its `*`. */
function prefixOf(pattern: string): string {
  return pattern.split("*")[0] ?? ""
}

/** The aliases the tsconfig at `file` declares, if any. */
function aliasesIn(file: string): PathAliases | undefined {
  const options = compilerOptionsOf(file)
  const patterns = Object.entries(recordOf(options.paths))
    .map(([pattern, targets]): [string, string[]] => [
      pattern,
      Array.isArray(targets) ? targets.filter((target) => typeof target === "string") : [],
    ])
    .toSorted(([a], [b]) => prefixOf(b).length - prefixOf(a).length)

  if (patterns.length === 0) return undefined

  return { base: options.baseUrl ?? options.pathsFrom ?? dirname(file), patterns }
}

/** The aliases of the nearest `tsconfig.json` at or above `folder`, up to the repository's root. */
function aliasesFor(folder: string): PathAliases | undefined {
  if (byFolder.has(folder)) return byFolder.get(folder)

  const config = join(folder, "tsconfig.json")
  const parent = dirname(folder)
  const found = existsSync(config)
    ? aliasesIn(config)
    : parent === folder || existsSync(join(folder, ".git"))
      ? undefined
      : aliasesFor(parent)

  byFolder.set(folder, found)

  return found
}

/** What `*` stands for when `specifier` matches `pattern`, or undefined when it does not. */
function wildcard(pattern: string, specifier: string): string | undefined {
  const star = pattern.indexOf("*")

  if (star === -1) return pattern === specifier ? "" : undefined

  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  const fits =
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)

  return fits ? specifier.slice(prefix.length, specifier.length - suffix.length) : undefined
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

/** The TypeScript file a target path means: itself, `.js` read as `.ts`, `.ts`, or `index.ts`. */
function fileFor(path: string): string | undefined {
  const candidates = path.endsWith(".js")
    ? [path.replace(/\.js$/, ".ts"), path]
    : [path, `${path}.ts`, `${path}.mts`, join(path, "index.ts")]

  return candidates.find(isFile)
}

/**
 * The file URL a bare `specifier` imported from a project file `parentURL` names through the
 * nearest tsconfig's `paths`, when one matches a file that exists.
 */
export function aliasedFile(specifier: string, parentURL: string | undefined): string | undefined {
  const parent = projectFile(parentURL)

  if (parent === undefined || /^(\.|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) return undefined

  const aliases = aliasesFor(dirname(parent))
  const file = aliases === undefined ? undefined : fileThrough(aliases, specifier)

  return file === undefined ? undefined : pathToFileURL(file).href
}

/** The path of `url` when it is a file of the project's own, not one under `node_modules`. */
function projectFile(url: string | undefined): string | undefined {
  if (url === undefined || !url.startsWith("file:")) return undefined

  const path = fileURLToPath(url)

  return /[\\/]node_modules[\\/]/.test(path) ? undefined : path
}

/** The first existing file a pattern matching `specifier` maps it to. */
function fileThrough(aliases: PathAliases, specifier: string): string | undefined {
  for (const [pattern, targets] of aliases.patterns) {
    const star = wildcard(pattern, specifier)
    const file =
      star === undefined
        ? undefined
        : targets
            .map((target) => fileFor(resolve(aliases.base, target.replace("*", star))))
            .find((found) => found !== undefined)

    if (file !== undefined) return file
  }

  return undefined
}
