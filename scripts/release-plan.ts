/**
 * The decisions behind a release, kept free of the file system and child processes so they can be
 * tested: what the command line asks for, whether the release may go ahead, what each package's
 * staged package.json says, and the order the packages publish in.
 * `scripts/release.ts` carries them out.
 */
import { parseArgs } from "node:util"

/** The package folders that stay private: nothing a user installs depends on them. */
const PRIVATE_FOLDERS: readonly string[] = ["fidelity", "ui"]

/** The fields whose dependencies a user's install or the repository's own reads. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
] as const

/** The fields a user's install reads: what a published package needs at run time. */
const RUNTIME_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const

type Dependencies = Readonly<Record<string, string>>

/** The parts of a package.json a release reads; the rest is carried over as it is. */
export interface Manifest {
  readonly name: string
  readonly version?: string
  readonly private?: boolean
  readonly dependencies?: Dependencies
  readonly peerDependencies?: Dependencies
  readonly optionalDependencies?: Dependencies
  readonly devDependencies?: Dependencies
  readonly [field: string]: unknown
}

/** A package in the repository: its folder under `packages/` and its package.json. */
export interface WorkspacePackage {
  readonly folder: string
  readonly manifest: Manifest
}

/** What the command line asks for. */
export interface ReleaseArgs {
  readonly version: string
  /** `pack` writes the tarballs; `publish` also publishes them (CI only). */
  readonly mode: "pack" | "publish"
  /** Install the tarballs into a fresh project and run danwo there before anything else. */
  readonly verify: boolean
  /** Where the tarballs go, relative to the repository unless absolute. */
  readonly out: string
}

const USAGE =
  "usage: node scripts/release.ts <version> [--pack | --publish] [--verify] [--out <dir>]"

/** The command line, read; throws with the usage when it is not one. */
export function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      pack: { type: "boolean", default: false },
      publish: { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      out: { type: "string", default: "dist/release" },
    },
  })
  const [version, ...extra] = positionals

  if (version === undefined || extra.length > 0) throw new Error(USAGE)
  if (values.pack && values.publish)
    throw new Error(`--pack and --publish exclude each other\n${USAGE}`)

  return {
    version,
    mode: values.publish ? "publish" : "pack",
    verify: values.verify,
    out: values.out,
  }
}

/** Semantic Versioning 2.0.0's grammar, without a leading `v`. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** Whether `version` is a valid semantic version, e.g. `0.1.0-beta.0`. */
export function isSemver(version: string): boolean {
  return SEMVER.test(version)
}

/** The npm dist-tag a version publishes under: `beta` for a prerelease, `latest` otherwise. */
export function distTag(version: string): "beta" | "latest" {
  return SEMVER.exec(version)?.[4] === undefined ? "latest" : "beta"
}

/** The packages that get published: every one but the private folders. */
export function publicPackages(packages: readonly WorkspacePackage[]): WorkspacePackage[] {
  return packages.filter((pkg) => !PRIVATE_FOLDERS.includes(pkg.folder))
}

/** The dependencies of `manifest` in `fields`, as name and range. */
function entriesOf(manifest: Manifest, fields: readonly (typeof DEPENDENCY_FIELDS)[number][]) {
  return fields.flatMap((field) => Object.entries(manifest[field] ?? {}))
}

/** What stops a release, if anything: a dirty tree, a bad version, a private runtime dependency. */
export function refusals(input: {
  readonly version: string
  /** `git status --porcelain`'s output. */
  readonly gitStatus: string
  readonly packages: readonly WorkspacePackage[]
}): string[] {
  const kept = new Set(
    input.packages
      .filter((pkg) => PRIVATE_FOLDERS.includes(pkg.folder))
      .map((pkg) => pkg.manifest.name),
  )
  const dirty =
    input.gitStatus.trim() === "" ? [] : [`the git tree has changes:\n${input.gitStatus.trimEnd()}`]
  const version = isSemver(input.version) ? [] : [`"${input.version}" is not a semantic version`]
  const leaks = publicPackages(input.packages).flatMap((pkg) =>
    entriesOf(pkg.manifest, RUNTIME_FIELDS)
      .filter(([name]) => kept.has(name))
      .map(([name]) => `${pkg.manifest.name} needs ${name} at run time, which stays private`),
  )

  return [...dirty, ...version, ...leaks]
}

/** A dependency range with `workspace:` replaced: `*` by the version, `^`/`~` by the range on it. */
export function releasedRange(range: string, version: string): string {
  if (!range.startsWith("workspace:")) return range

  const rest = range.slice("workspace:".length)

  if (rest === "*" || rest === "") return version
  if (rest === "^" || rest === "~") return `${rest}${version}`

  return rest
}

/** The package.json a package is packed with: at `version`, not private, no `workspace:` ranges. */
export function stagedManifest(manifest: Manifest, version: string): Manifest {
  const { private: _private, ...rest } = manifest
  const fields = DEPENDENCY_FIELDS.flatMap((field) => {
    const deps = manifest[field]

    if (deps === undefined) return []

    const released = Object.entries(deps).map(([name, range]) => [
      name,
      releasedRange(range, version),
    ])

    return [[field, Object.fromEntries(released)]]
  })

  return { ...rest, version, ...Object.fromEntries(fields) }
}

/**
 * The order the packages publish in: each after the ones it depends on, so an install of any
 * published package finds its dependencies already there. Ties go alphabetically.
 */
export function publishOrder(manifests: readonly Manifest[]): string[] {
  const names = new Set(manifests.map((manifest) => manifest.name))
  const waiting = new Map(
    manifests.map((manifest) => [
      manifest.name,
      new Set(
        entriesOf(manifest, RUNTIME_FIELDS)
          .map(([name]) => name)
          .filter((name) => names.has(name)),
      ),
    ]),
  )
  const order: string[] = []

  while (waiting.size > 0) {
    const ready = [...waiting]
      .filter(([, deps]) => deps.size === 0)
      .map(([name]) => name)
      .toSorted()

    if (ready.length === 0)
      throw new Error(`dependency cycle among ${[...waiting.keys()].join(", ")}`)

    for (const name of ready) {
      waiting.delete(name)
      order.push(name)
      for (const deps of waiting.values()) deps.delete(name)
    }
  }

  return order
}

/** A byte count for people: `5.9 MB`, `312.4 kB`. */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`

  return `${(bytes / 1_000).toFixed(1)} kB`
}

/** A tarball `npm pack` wrote: the package, the file's name, and its packed and unpacked bytes. */
export interface Tarball {
  readonly name: string
  readonly filename: string
  readonly size: number
  readonly unpackedSize: number
}

/** The number at `key` of `value`, or 0. */
function count(value: unknown, key: string): number {
  const found: unknown = Reflect.get(Object(value), key)

  return typeof found === "number" ? found : 0
}

/** The tarball `npm pack --json` printed (one package, so one entry). */
export function packedTarball(json: string): Tarball {
  const [entry]: unknown[] = [JSON.parse(json)].flat()
  const name: unknown = Reflect.get(Object(entry), "name")
  const filename: unknown = Reflect.get(Object(entry), "filename")

  if (typeof name !== "string" || typeof filename !== "string")
    throw new Error(`npm pack printed no tarball:\n${json}`)

  return { name, filename, size: count(entry, "size"), unpackedSize: count(entry, "unpackedSize") }
}

/** The summary printed after packing: each package, its tarball and size. */
export function summaryLines(tarballs: readonly Tarball[], out: string): string[] {
  const width = Math.max(...tarballs.map((tarball) => tarball.name.length))
  const file = Math.max(...tarballs.map((tarball) => tarball.filename.length))
  const total = tarballs.reduce((sum, tarball) => sum + tarball.size, 0)

  return [
    `${tarballs.length} tarballs in ${out} (${formatSize(total)})`,
    ...tarballs.map(
      (tarball) =>
        `  ${tarball.name.padEnd(width)}  ${tarball.filename.padEnd(file)}  ${formatSize(tarball.size).padStart(8)}  (${formatSize(tarball.unpackedSize)} unpacked)`,
    ),
  ]
}

/** The processes among `rows` whose command line mentions `marker`. */
export function processesUnder(
  rows: readonly { readonly pid: number; readonly command: string }[],
  marker: string,
): { readonly pid: number; readonly command: string }[] {
  return rows
    .filter((row) => row.command.includes(marker))
    .map(({ pid, command }) => ({ pid, command }))
}

/** How a check step ended: its exit status, everything it printed, and how long it took. */
export interface StepResult {
  readonly status: number | null
  readonly output: string
  readonly ms: number
}

/**
 * Whether a check step passed (exit 0, and its output holds `expected` when given), with the
 * lines to print: the verdict, then the output's last lines, more of them when it failed.
 */
export function stepReport(
  label: string,
  result: StepResult,
  expected?: string,
): { ok: boolean; lines: string[] } {
  const output = result.output.trim()
  const ok = result.status === 0 && output.includes(expected ?? "")
  const tail = output
    .split(/\r?\n/)
    .slice(ok ? -4 : -40)
    .filter((line) => line.trim() !== "")
  const verdict = `  ${ok ? "ok    " : "FAILED"} ${label} (${(result.ms / 1000).toFixed(1)} s)`

  return { ok, lines: [verdict, ...tail.map((line) => `         ${line}`)] }
}
