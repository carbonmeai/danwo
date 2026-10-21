/**
 * Installs an example against danwo's release tarballs, before the version it pins is on npm.
 *
 * Usage: `node examples/link.ts <example> [--tarballs <dir>] [--to <dir> | --here]`
 *
 * It copies `examples/<example>` to a fresh folder (or `--to`), points every `@danwo/*` package
 * its package.json names, and every one those depend on, at the tarballs in `--tarballs`
 * (`dist/release`, which `bun run release <version> --pack` writes), and runs `npm install` there.
 * The example's own folder is left as it is. The last line it prints is the installed copy's
 * path, so a script can `cd "$(node examples/link.ts with-next | tail -n 1)"`.
 *
 * With `--here` it installs into the example's own folder instead, so an editor open on it finds
 * the types: package.json is linked for the install and put back as it was afterwards, and npm
 * writes no lockfile. Only the git-ignored `node_modules` is left behind.
 */
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** What the copy leaves out: installs, builds and run output from a run in the example's folder. */
const SKIPPED = new Set([
  "node_modules",
  ".next",
  ".next-build-lock",
  "dist",
  ".web-build-lock",
  ".danwo",
  "package-lock.json",
])

/** A release tarball: the package it holds, its version and its path. */
export interface Tarball {
  readonly name: string
  readonly version: string
  readonly file: string
}

/** The danwo tarballs in `dir`, by the names `npm pack` gives them: `danwo-cli-0.1.0.tgz`. */
export function tarballsIn(dir: string): Tarball[] {
  return readdirSync(dir).flatMap((file) => {
    const match = /^danwo-([a-z-]+?)-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/.exec(file)

    return match
      ? [{ name: `@danwo/${match[1] ?? ""}`, version: match[2] ?? "", file: join(dir, file) }]
      : []
  })
}

type Manifest = Readonly<Record<string, unknown>>

/** A dependency field of `manifest` (name to range), or an empty one. */
function field(manifest: Manifest, name: string): Readonly<Record<string, string>> {
  const value: unknown = manifest[name]

  if (typeof value !== "object" || value === null) return {}

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, range]: [string, unknown]) =>
      typeof range === "string" ? [[key, range]] : [],
    ),
  )
}

/** The package.json in `dir`. */
function readManifest(dir: string): Manifest {
  const parsed: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

  if (typeof parsed !== "object" || parsed === null)
    throw new Error(`${dir}/package.json is not an object`)

  return Object.fromEntries(Object.entries(parsed))
}

/**
 * `manifest` with each `@danwo/*` dependency, and each one the tarballs pull in, installed from
 * its tarball. Throws when the example names a package no tarball holds, or pins another version.
 */
export function linkedManifest(manifest: Manifest, tarballs: readonly Tarball[]): Manifest {
  const byName = new Map(tarballs.map((tarball) => [tarball.name, tarball]))
  const spec = (tarball: Tarball) => `file:${tarball.file}`

  const linked = (name: string): Readonly<Record<string, string>> => {
    const own = field(manifest, name)

    return Object.fromEntries(
      Object.entries(own).map(([dependency, range]) => {
        if (!dependency.startsWith("@danwo/")) return [dependency, range]

        const tarball = byName.get(dependency)

        if (tarball === undefined) throw new Error(`no tarball holds ${dependency}`)
        if (range !== tarball.version)
          throw new Error(
            `the example pins ${dependency}@${range}; the tarball is ${tarball.version}`,
          )

        return [dependency, spec(tarball)]
      }),
    )
  }

  return {
    ...manifest,
    dependencies: linked("dependencies"),
    devDependencies: linked("devDependencies"),
    overrides: {
      ...field(manifest, "overrides"),
      ...Object.fromEntries(tarballs.map((tarball) => [tarball.name, spec(tarball)])),
    },
  }
}

/** Where to install: a copy (in `to`, or a fresh folder), or the example's own folder. */
type Target = { readonly kind: "copy"; readonly to: string | undefined } | { readonly kind: "here" }

/** Links the example's package.json in `dir` to the tarballs and runs `npm install` there. */
function install(dir: string, tarballs: readonly Tarball[], lockfile: boolean): void {
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(linkedManifest(readManifest(dir), tarballs), null, 2)}\n`,
  )

  /* npm's own output goes to stderr, so the path is the only thing on stdout. */
  const result = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", ...(lockfile ? [] : ["--no-package-lock"])],
    { cwd: dir, stdio: ["ignore", process.stderr, process.stderr] },
  )

  if (result.status !== 0) throw new Error(`npm install failed in ${dir}`)
}

/** Installs the example against the tarballs, in a copy or in its own folder; where it went. */
function link(example: string, tarballDir: string, target: Target): string {
  const source = join(ROOT, "examples", example)

  if (!existsSync(join(source, "package.json")))
    throw new Error(`examples/${example} is not an example: it has no package.json`)

  const tarballs = tarballsIn(tarballDir)

  if (tarballs.length === 0)
    throw new Error(`no danwo tarballs in ${tarballDir}; run: bun run release <version> --pack`)

  if (target.kind === "here") {
    const original = readFileSync(join(source, "package.json"))

    try {
      install(source, tarballs, false)
    } finally {
      writeFileSync(join(source, "package.json"), original)
    }

    return source
  }

  const copy = target.to ?? join(mkdtempSync(join(tmpdir(), `danwo-${example}-`)), example)

  cpSync(source, copy, { recursive: true, filter: (path) => !SKIPPED.has(basename(path)) })
  install(copy, tarballs, true)

  return copy
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      tarballs: { type: "string" },
      to: { type: "string" },
      here: { type: "boolean", default: false },
    },
  })
  const [example] = positionals

  if (example === undefined || (values.here && values.to !== undefined)) {
    console.error("usage: node examples/link.ts <example> [--tarballs <dir>] [--to <dir> | --here]")
    process.exit(2)
  }

  const tarballs = resolve(values.tarballs ?? join(ROOT, "dist", "release"))
  const target: Target = values.here
    ? { kind: "here" }
    : { kind: "copy", to: values.to === undefined ? undefined : resolve(values.to) }

  console.log(link(example, tarballs, target))
}
