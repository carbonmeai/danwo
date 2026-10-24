/**
 * What a config or test file that fails to load is told. danwo loads them with Node's own type
 * stripping, which removes type annotations but compiles nothing, so TypeScript that needs
 * compiling (an `enum`, a constructor's parameter properties, a `namespace`) fails with Node's raw
 * error. These name the file and line, what is not supported, and what to write instead.
 */
import { isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"

import { DanwoError } from "../support/codes.ts"
import { isOptionalPackage, packageOf, PackageMissingError } from "../support/optional-packages.ts"
import { relativeSlashed } from "../support/paths.ts"

/** What Node's strip-only mode rejects, by its message, and what to write instead. */
const UNSUPPORTED: readonly (readonly [RegExp, string, string])[] = [
  [
    /\benum\b/,
    "an `enum`",
    'use a plain object with `as const` (e.g. `const Plan = { Free: "free" } as const`) and a union type for its values',
  ],
  [
    /parameter property/,
    "a constructor parameter property (`constructor(private x: T)`)",
    "declare the field in the class body and assign it in the constructor",
  ],
  [/namespace/, "a `namespace`", "export the values from the module itself"],
  [/angle-bracket/, "an angle-bracket type assertion (`<T>value`)", "write `value as T`"],
  [/import.*require|export =/, "`import x = require()` or `export =`", "use `import` and `export`"],
]

/** `path` from the working folder when it is inside it, else as it is. */
function shown(path: string): string {
  const from = relativeSlashed(process.cwd(), path)

  return from === "" || from.startsWith("..") || isAbsolute(from) ? path : from
}

/** The `file:line` Node's syntax errors put on their stack's first line, as a path. */
function locationOf(error: Error): string | undefined {
  const first = (error.stack ?? "").split("\n")[0] ?? ""
  const match = /^(file:\/\/\S+?):(\d+)$/.exec(first.trim())

  if (match?.[1] === undefined) return undefined

  return `${shown(fileURLToPath(match[1]))}:${match[2] ?? ""}`
}

function codeOf(error: Error): unknown {
  return Reflect.get(error, "code")
}

/** The bare specifier a "Cannot find package" error names, and the file that imported it. */
function missingPackage(error: Error): { specifier: string; from: string } | undefined {
  const match = /Cannot find package '([^']+)' imported from (.+)$/.exec(error.message)

  return match?.[1] === undefined ? undefined : { specifier: match[1], from: shown(match[2] ?? "") }
}

/** What to say about TypeScript Node's strip-only mode refused in `what`. */
function unsupportedMessage(error: Error, what: string): string {
  const where = locationOf(error) ?? what
  const known = UNSUPPORTED.find(([pattern]) => pattern.test(error.message))
  const feature = known?.[1] ?? "TypeScript that needs compiling"
  const fix =
    known?.[2] ?? `rewrite it as plain JavaScript with type annotations (${error.message})`

  return `${where}: ${feature} cannot load in ${what} or a file it imports. danwo runs TypeScript with Node's type stripping, which removes types and compiles nothing. Instead, ${fix}. (danwo guide first-test lists what test and config files may use.)`
}

/** Why `error` stopped TypeScript in `what` from loading, in danwo's words; undefined if not that. */
function strippingMessage(error: Error, what: string): string | undefined {
  if (codeOf(error) === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX") return unsupportedMessage(error, what)
  if (codeOf(error) === "ERR_INVALID_TYPESCRIPT_SYNTAX")
    return `${locationOf(error) ?? what}: ${what} is not valid TypeScript: ${error.message}`

  const missing = codeOf(error) === "ERR_MODULE_NOT_FOUND" ? missingPackage(error) : undefined

  if (missing === undefined) return undefined

  return `${what} imports "${missing.specifier}" (from ${missing.from}), which is neither an installed package nor an alias the nearest tsconfig.json's "paths" maps to a file. Install it, fix the alias, or import the file by its relative path with its extension (e.g. "../lib/cart.ts").`
}

/**
 * `error` as danwo tells it when `file` (a `config` or a `test` file) failed to load because of
 * what Node's type stripping supports, else `error` itself.
 */
export function explainLoadError(error: unknown, file: string, kind: "config" | "test"): unknown {
  if (!(error instanceof Error)) return error

  const what = kind === "config" ? `the config ${shown(file)}` : `the test file ${shown(file)}`
  const missing = codeOf(error) === "ERR_MODULE_NOT_FOUND" ? missingPackage(error) : undefined
  const optional = missing === undefined ? "" : packageOf(missing.specifier)

  if (isOptionalPackage(optional)) return new PackageMissingError(what, optional, { cause: error })

  const message = strippingMessage(error, what)

  return message === undefined ? error : new DanwoError("CONFIG_INVALID", message, { cause: error })
}
