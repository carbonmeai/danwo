/**
 * Packages of other projects that a danwo feature runs on and a project installs only when it uses
 * that feature: Yjs for the Tiptap emulator, `pg` for Postgres snapshots. danwo installs none of
 * them itself. A config that uses such a feature in a project that lacks its packages is told so
 * once, before any test starts, with one command that adds every missing package, rather than one
 * package per run as each feature fails in turn.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { DanwoError } from "./codes.ts"
import { devInstallCommand } from "./optional-packages.ts"

/** A feature, the call in a config that uses it, the packages it needs, and the one that loads them. */
interface PeerFeature {
  readonly feature: string
  readonly call: RegExp
  readonly packages: readonly string[]
  readonly owner: string
}

const PEER_FEATURES: readonly PeerFeature[] = [
  {
    feature: "the Tiptap emulator",
    call: /\btiptapService\s*\(/,
    packages: ["yjs", "y-protocols"],
    owner: "@danwo/emulators",
  },
  {
    feature: "Postgres snapshots",
    call: /\bpostgresSnapshot\s*\(/,
    packages: ["pg"],
    owner: "@danwo/data",
  },
]

/** A feature the config uses and the packages it needs that the project lacks. */
export interface MissingPeers {
  readonly feature: string
  readonly packages: readonly string[]
}

function textOf(file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

/** The relative module a specifier names, by the extensions a config's imports are written with. */
function localModule(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier)

  return [base, `${base}.ts`, `${base}.js`, join(base, "index.ts")].find(existsSync) ?? base
}

/** The source of the config file and of the local modules it imports, one level deep. */
function configSource(configFile: string): string {
  const own = textOf(configFile)
  const imported = [...own.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].map((match) =>
    textOf(localModule(configFile, match[1] ?? "")),
  )

  return [own, ...imported].join("\n")
}

/** Each folder from `from` up to the filesystem's root. */
function upFrom(from: string): string[] {
  const dirs = [from]

  while (dirname(dirs.at(-1) ?? from) !== dirs.at(-1)) dirs.push(dirname(dirs.at(-1) ?? from))

  return dirs
}

/**
 * Where the project at `root` has the danwo package `owner`, as its real folder: hoisted, or under
 * `@danwo/sdk` as pnpm nests it, or in a checkout of danwo's repository linked in.
 */
function ownerDirs(root: string, owner: string): string[] {
  return upFrom(root).flatMap((dir) =>
    [
      join(dir, "node_modules", owner),
      join(dir, "node_modules", "@danwo", "sdk", "node_modules", owner),
    ]
      .filter((path) => existsSync(path))
      .map((path) => realpathSync(path)),
  )
}

/** Whether `name` can be loaded by `owner` (which loads it), or from the project at `root`. */
function installed(root: string, owner: string, name: string): boolean {
  return [root, ...ownerDirs(root, owner)].some((from) =>
    upFrom(from).some((dir) => existsSync(join(dir, "node_modules", name, "package.json"))),
  )
}

/** The features the config at `configFile` uses whose packages the project at `root` lacks. */
export function missingPeers(configFile: string, root: string): MissingPeers[] {
  const source = configSource(configFile)

  return PEER_FEATURES.filter(({ call }) => call.test(source)).flatMap((uses) => {
    const { feature, packages, owner } = uses
    const missing = packages.filter((name) => !installed(root, owner, name))

    return missing.length > 0 ? [{ feature, packages: missing }] : []
  })
}

/** The one command that adds every package in `missing` to the project at `root`. */
export function peerAddCommand(missing: readonly MissingPeers[], root: string): string {
  return devInstallCommand([...new Set(missing.flatMap(({ packages }) => packages))], root)
}

/**
 * Fails with `PACKAGE_MISSING`, before any test starts, when the config uses features whose
 * packages the project lacks: every such feature and package at once, and the command that adds
 * them all.
 */
export function checkPeers({
  path: configFile,
  root,
}: {
  readonly path?: string | undefined
  readonly root: string
}): void {
  if (configFile === undefined) return

  const missing = missingPeers(configFile, root)

  if (missing.length === 0) return

  const uses = missing.map(({ feature, packages }) => `${feature} (${packages.join(", ")})`)

  throw new DanwoError(
    "PACKAGE_MISSING",
    `the config uses ${uses.join(" and ")}, which this project has not installed: ${peerAddCommand(missing, root)}`,
  )
}
