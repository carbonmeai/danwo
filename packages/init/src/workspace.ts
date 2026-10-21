/**
 * The monorepo a project belongs to, when it belongs to one: a pnpm workspace
 * (`pnpm-workspace.yaml`), or an npm, Yarn or Bun workspace (a `workspaces` field in the root
 * `package.json`). A package inside a workspace installs with the workspace's package manager, and
 * in the way that manager expects from where init runs: `-w` at the root of a pnpm workspace,
 * `--workspace <path>` from the root for npm.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

export const PACKAGE_MANAGERS = ["bun", "pnpm", "yarn", "npm"] as const

export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

/** Lockfiles, in the order a project that has several is most likely using. */
const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
]

/** A workspace and where the project sits in it. */
export interface Workspace {
  /** The workspace's root folder. */
  readonly root: string
  /** The project's folder relative to the root, with `/` separators; `""` at the root itself. */
  readonly path: string
  readonly packageManager: PackageManager
  /** Yarn 2 or newer, which has no `-W` and adds to the root without it. */
  readonly yarnBerry: boolean
}

/** The parsed JSON in `path`, or undefined when it is missing or not JSON. */
function readJsonSync(path: string): unknown {
  if (!existsSync(path)) return undefined

  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

/** Whether `value` is a plain JSON object. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : []
}

/** The package globs a `pnpm-workspace.yaml` lists under `packages:`. */
export function pnpmPackages(yaml: string): string[] {
  const globs: string[] = []
  let inPackages = false

  for (const line of yaml.split("\n")) {
    const text = line.replace(/#.*$/, "").trimEnd()

    if (text.trim() === "") continue

    if (/^\S/.test(text)) {
      inPackages = /^packages\s*:/.test(text)

      continue
    }

    const item = inPackages ? /^\s+-\s*["']?([^"']+?)["']?\s*$/.exec(text) : null

    if (item?.[1] !== undefined) globs.push(item[1])
  }

  return globs
}

/** The package globs a root `package.json` lists in `workspaces` (an array, or Yarn's object). */
function packageJsonWorkspaces(pkg: Readonly<Record<string, unknown>>): string[] | undefined {
  const field = pkg["workspaces"]

  if (Array.isArray(field)) return strings(field)
  if (isRecord(field)) return strings(field["packages"])

  return undefined
}

/** A workspace glob as a regular expression over `/`-separated relative paths. */
function globPattern(glob: string): RegExp {
  const body = glob
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .split(/(\*\*\/?|\*|\?)/)
    .map((part) => {
      if (part === "**/" || part === "**") return "(?:.*/)?"
      if (part === "*") return "[^/]*"
      if (part === "?") return "[^/]"

      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    })
    .join("")

  return new RegExp(`^${body.replace(/\(\?:\.\*\/\)\?$/, ".*")}$`)
}

/** Whether `path` is one of the workspace's packages: matched by a glob, and by no `!` glob. */
export function isMember(path: string, globs: readonly string[]): boolean {
  const included = globs.filter((glob) => !glob.startsWith("!"))
  const excluded = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1))

  return (
    included.some((glob) => globPattern(glob).test(path)) &&
    !excluded.some((glob) => globPattern(glob).test(path))
  )
}

/** The package manager `packageManager` names, e.g. `pnpm@9.0.0` → `pnpm`. */
export function declaredManager(pkg: {
  readonly packageManager?: unknown
}): PackageManager | undefined {
  const declared = pkg["packageManager"]
  const name = typeof declared === "string" ? declared.split("@")[0] : ""

  return PACKAGE_MANAGERS.find((pm) => pm === name)
}

/** The package manager whose lockfile is in `folder`. */
export function lockedManager(folder: string): PackageManager | undefined {
  return LOCKFILES.find(([file]) => existsSync(join(folder, file)))?.[1]
}

/** Whether the Yarn in `root` is Yarn 2 or newer: it says so in `packageManager` or has `.yarnrc.yml`. */
function isYarnBerry(root: string, pkg: Readonly<Record<string, unknown>>): boolean {
  const declared = pkg["packageManager"]
  const major = typeof declared === "string" ? /^yarn@(\d+)/.exec(declared)?.[1] : undefined

  return major === undefined ? existsSync(join(root, ".yarnrc.yml")) : Number(major) >= 2
}

/** The package globs `folder` declares as a workspace root, and whether it is pnpm's. */
function declaredGlobs(
  folder: string,
  pkg: Readonly<Record<string, unknown>>,
): { globs: string[]; pnpm: boolean } | undefined {
  const pnpmFile = join(folder, "pnpm-workspace.yaml")

  if (existsSync(pnpmFile))
    return { globs: pnpmPackages(readFileSync(pnpmFile, "utf8")), pnpm: true }

  const globs = packageJsonWorkspaces(pkg)

  return globs === undefined ? undefined : { globs, pnpm: false }
}

/** The manager of a workspace that is not pnpm's: its `packageManager`, a lockfile, the one running. */
function workspaceManager(
  folder: string,
  pkg: Readonly<Record<string, unknown>>,
  userAgent: string | undefined,
): PackageManager {
  return (
    declaredManager(pkg) ??
    lockedManager(folder) ??
    PACKAGE_MANAGERS.find((pm) => userAgent?.startsWith(`${pm}/`)) ??
    "npm"
  )
}

/**
 * The workspace `project` belongs to: the nearest folder at or above it that declares one, when
 * `project` is that folder or one of the packages it lists. A folder under a workspace that is not
 * one of its packages is a project of its own. The search stops at the repository's root (the
 * folder holding `.git`).
 */
export function findWorkspace(project: string, userAgent?: string): Workspace | undefined {
  const start = resolve(project)

  for (let folder = start, above = dirname(start); ; folder = above, above = dirname(folder)) {
    const pkg = recordOf(readJsonSync(join(folder, "package.json")))
    const declared = declaredGlobs(folder, pkg)

    if (declared !== undefined) {
      const path = relative(folder, start).split(sep).join("/")

      if (path !== "" && !isMember(path, declared.globs)) return undefined

      const packageManager = declared.pnpm ? "pnpm" : workspaceManager(folder, pkg, userAgent)
      const yarnBerry = packageManager === "yarn" && isYarnBerry(folder, pkg)

      return { root: folder, path, packageManager, yarnBerry }
    }

    if (above === folder || existsSync(join(folder, ".git"))) return undefined
  }
}
