/**
 * The danwo packages a project adds only for the features that need them, so a web project
 * installs none of them: the device driver, the MCP server and the recorder. A command or a config
 * that needs one the project does not have fails with `PACKAGE_MISSING`, naming the command that
 * adds it at this danwo's version, with the project's own package manager.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { DanwoError } from "./codes.ts"

/** Each optional package, and the features it adds. */
export const OPTIONAL_PACKAGES = {
  "@danwo/mobile": "mobile tests on Android and iOS (danwo device, build-android, build-ios)",
  "@danwo/mcp": "danwo's MCP server for coding agents (danwo mcp)",
  "@danwo/recorder": "recording a test in the browser (danwo record)",
} as const satisfies Readonly<Record<string, string>>

export type OptionalPackage = keyof typeof OPTIONAL_PACKAGES

/** Every optional package, in the order `danwo doctor` lists them. */
export const OPTIONAL_PACKAGE_NAMES = Object.keys(OPTIONAL_PACKAGES).filter(isOptionalPackage)

/** Whether `name` is one of the optional packages. */
export function isOptionalPackage(name: string): name is OptionalPackage {
  return Object.hasOwn(OPTIONAL_PACKAGES, name)
}

/** The package a bare specifier names: `@danwo/mobile/build` → `@danwo/mobile`. */
export function packageOf(specifier: string): string {
  const parts = specifier.split("/")

  return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/")
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun"

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
]

const ADD: Readonly<Record<PackageManager, string>> = {
  npm: "npm install -D",
  pnpm: "pnpm add -D",
  yarn: "yarn add -D",
  bun: "bun add -d",
}

/** The package manager `packageManager` in `folder`'s package.json names, if any. */
function declaredIn(folder: string): PackageManager | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"))
    const declared: unknown = Reflect.get(Object(manifest), "packageManager")
    const name = typeof declared === "string" ? declared.split("@")[0] : undefined

    return Object.keys(ADD).find((pm): pm is PackageManager => pm === name)
  } catch {
    return undefined
  }
}

/**
 * The package manager of the project at `cwd`: the first `packageManager` field or lockfile from
 * `cwd` up, else npm.
 */
export function packageManagerAt(cwd: string): PackageManager {
  for (let folder = cwd; ; folder = dirname(folder)) {
    const found =
      declaredIn(folder) ?? LOCKFILES.find(([file]) => existsSync(join(folder, file)))?.[1]

    if (found !== undefined) return found
    if (dirname(folder) === folder) return "npm"
  }
}

/** This danwo's version, which its packages share; `0.0.0` in danwo's own repository. */
function danwoVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  )
  const version: unknown = Reflect.get(Object(manifest), "version")

  return typeof version === "string" ? version : "0.0.0"
}

/** The command that adds `specs` as dev dependencies of the project at `cwd`, with its manager. */
export function devInstallCommand(specs: readonly string[], cwd = process.cwd()): string {
  return `${ADD[packageManagerAt(cwd)]} ${specs.join(" ")}`
}

/** The command that adds `name` to the project at `cwd`, at this danwo's version. */
export function addCommand(name: OptionalPackage, cwd = process.cwd()): string {
  const version = danwoVersion()

  return devInstallCommand([version === "0.0.0" ? name : `${name}@${version}`], cwd)
}

/** `needs` (a command, or a config) cannot run without the optional package `name`. */
export class PackageMissingError extends DanwoError {
  readonly package: OptionalPackage

  constructor(needs: string, name: OptionalPackage, options?: ErrorOptions & { cwd?: string }) {
    super("PACKAGE_MISSING", `${needs} needs ${name}: ${addCommand(name, options?.cwd)}`, options)
    this.name = "PackageMissingError"
    this.package = name
  }
}

/** Whether `error` is Node's failure to find the package `name` itself (not one it imports). */
export function isMissingPackage(error: unknown, name: string): boolean {
  if (!(error instanceof Error)) return false

  const code: unknown = Reflect.get(error, "code")

  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false

  return ["package", "module"].some((kind) =>
    [`'${name}'`, `'${name}/`].some((quoted) =>
      error.message.includes(`Cannot find ${kind} ${quoted}`),
    ),
  )
}

/**
 * Loads an optional package with `load` (an `import()` of it, written where the package is a
 * peer, so every package manager resolves it). When the project has not installed it, rejects
 * with a `PackageMissingError` that says what `needs` it and the command that adds it.
 */
export async function loadOptional<T>(
  name: OptionalPackage,
  needs: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (isMissingPackage(error, name)) throw new PackageMissingError(needs, name, { cause: error })
    throw error
  }
}
