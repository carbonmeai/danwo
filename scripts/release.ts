/**
 * Releases danwo's public packages, all at one version.
 *
 * Usage: `node scripts/release.ts <version> [--pack | --publish] [--verify] [--out <dir>]`
 *
 * - `--pack` (the default) builds the dashboard and the type declarations once, stages a copy of
 *   each public package at `version` (not private, every `workspace:` range set to the version, the
 *   repository's LICENSE and NOTICE and a README added), and writes one tarball per package with
 *   `npm pack` to `--out` (`dist/release`). The packages' own package.json files are not touched.
 * - `--verify` then installs every tarball into a fresh npm project and runs `danwo --version`,
 *   `danwo init`, `danwo test` and a strict `tsc --noEmit` there, then checks danwo left nothing
 *   running; any failure exits non-zero.
 * - `--publish` packs, then publishes the tarballs with `npm publish --provenance`, dependencies
 *   first, under `beta` for a prerelease and `latest` otherwise. Only CI runs it.
 *
 * It refuses a dirty git tree, a version that is not semver, and a public package that needs a
 * private one at run time. The decisions live in `release-plan.ts`.
 */
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { spawnPlan } from "../packages/runner/src/support/command-line.ts"
import { processRows } from "../packages/runner/src/support/process-table.ts"
import {
  distTag,
  type Manifest,
  packedTarball,
  parseReleaseArgs,
  processesUnder,
  publicPackages,
  publishOrder,
  refusals,
  type ReleaseArgs,
  stagedManifest,
  stepReport,
  summaryLines,
  type Tarball,
  type WorkspacePackage,
} from "./release-plan.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** A tarball `npm pack` wrote, and its path. */
interface Packed extends Tarball {
  readonly file: string
}

/** Whether parsed JSON looks like a package.json: an object with a `name`. */
function isManifest(value: unknown): value is Manifest {
  return typeof Reflect.get(Object(value), "name") === "string"
}

/** Every package under `packages/`, with its package.json. */
function workspacePackages(): WorkspacePackage[] {
  return readdirSync(join(ROOT, "packages"))
    .toSorted()
    .filter((folder) => existsSync(join(ROOT, "packages", folder, "package.json")))
    .map((folder) => {
      const manifest: unknown = JSON.parse(
        readFileSync(join(ROOT, "packages", folder, "package.json"), "utf8"),
      )

      if (!isManifest(manifest)) throw new Error(`packages/${folder}/package.json has no "name"`)

      return { folder, manifest }
    })
}

/**
 * Runs `program` in `cwd`, found on PATH as a terminal would (npm is a `.cmd` script on
 * Windows), and gives back what it printed, or prints it here with `inherit`; throws when it fails.
 */
function runFor(
  program: string,
  args: readonly string[],
  cwd: string,
  stdio: "inherit" | "pipe",
): string {
  const plan = spawnPlan(program, args)
  const result = spawnSync(plan.command, plan.args, {
    cwd,
    stdio: ["ignore", stdio, "inherit"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  })

  assertRan(result, `${program} ${args.join(" ")}`)

  return result.stdout
}

/** Throws when the program `what` names could not start, or did not exit 0. */
function assertRan(result: SpawnSyncReturns<string>, what: string): void {
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${what} exited with ${result.status ?? result.signal}`)
}

/** Runs `program` in `cwd` with its output on this terminal; throws when it fails. */
function run(program: string, args: readonly string[], cwd: string): void {
  runFor(program, args, cwd, "inherit")
}

/** Runs `program` in `cwd` and gives back what it printed; throws when it fails. */
function output(program: string, args: readonly string[], cwd: string): string {
  return runFor(program, args, cwd, "pipe")
}

/** Removes `path`, retrying while Windows still holds a file in it open. */
function remove(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

/** Builds what the packages ship but git does not hold: the dashboard and the declarations. */
function build(): void {
  run("bun", ["run", "build"], join(ROOT, "packages", "dashboard"))
  run("node", ["scripts/declarations.ts"], ROOT)
}

/** Copies the public packages into `stage` at `version`, with what packing them needs beside. */
function stage(packages: readonly WorkspacePackage[], version: string, stageDir: string): void {
  for (const file of ["LICENSE", "NOTICE", "scripts/pack-files.ts"])
    cpSync(join(ROOT, file), join(stageDir, file))

  for (const { folder, manifest } of packages) {
    const target = join(stageDir, "packages", folder)

    cpSync(join(ROOT, "packages", folder), target, {
      recursive: true,
      filter: (source) => basename(source) !== "node_modules",
    })
    writeFileSync(
      join(target, "package.json"),
      `${JSON.stringify(stagedManifest(manifest, version), null, 2)}\n`,
    )
  }
}

/** Packs each staged package into `out`, adding LICENSE, NOTICE and a README first. */
function pack(packages: readonly WorkspacePackage[], stageDir: string, out: string): Packed[] {
  return packages.map(({ folder }) => {
    const cwd = join(stageDir, "packages", folder)

    run("node", [join(stageDir, "scripts", "pack-files.ts"), "add"], cwd)

    const json = output(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", out],
      cwd,
    )

    const tarball = packedTarball(json)

    return { ...tarball, file: join(out, tarball.filename) }
  })
}

/** A port nothing listens on right now, for the check's app. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()

    server.once("error", fail)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0

      server.close(() => done(port))
    })
  })
}

/** How long what danwo started may take to stop after it exits: its guardian's grace, and some. */
const LEFTOVER_GRACE_MS = 5_000

/** One command the check runs in the fresh project. */
interface CheckStep {
  readonly label: string
  readonly argv: readonly string[]
  /** Text the output must contain. */
  readonly expected?: string
  /** What to write before it runs. */
  readonly before?: () => void
}

/** Runs one check step in `cwd`, printing whether it passed and its last lines; true when it did. */
function step({ label, argv, expected }: CheckStep, cwd: string): boolean {
  const started = Date.now()
  const [program = "", ...args] = argv
  /* npm and npx are `.cmd` scripts on Windows, started through cmd.exe. */
  const plan = spawnPlan(program, args)
  const result = spawnSync(plan.command, plan.args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  })
  const report = stepReport(
    label,
    { status: result.status, output: `${result.stdout}${result.stderr}`, ms: Date.now() - started },
    expected,
  )

  for (const line of report.lines) console.log(line)

  return report.ok
}

/** The processes whose command line names the check project in `dir`. */
function runningUnder(dir: string): ReturnType<typeof processesUnder> {
  return processesUnder(
    processRows().filter((row) => row.pid !== process.pid),
    basename(dir),
  )
}

/** What still runs from `dir` once danwo's guardian had its grace period to stop it. */
async function leftRunning(dir: string): Promise<ReturnType<typeof processesUnder>> {
  const deadline = Date.now() + LEFTOVER_GRACE_MS

  while (runningUnder(dir).length > 0 && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 200))

  return runningUnder(dir)
}

function kill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    /* Already gone. */
  }
}

/**
 * Whether danwo stopped everything it started in the check project (the app, workers, emulators).
 * What is still running fails the check, and is stopped so the check leaves nothing behind.
 */
async function nothingLeftRunning(dir: string): Promise<boolean> {
  const left = await leftRunning(dir)

  for (const { pid } of left) kill(pid)

  const lines = stepReport("nothing left running", {
    status: left.length === 0 ? 0 : 1,
    output: left.map((found) => `${found.pid} ${found.command}`).join("\n"),
    ms: 0,
  }).lines

  for (const line of lines) console.log(line)

  return left.length === 0
}

/** The app `danwo test` starts in the check project: one page on `port`. */
function appSource(port: number): string {
  return [
    'import { createServer } from "node:http"',
    "",
    "createServer((_request, response) => {",
    '  response.writeHead(200, { "content-type": "text/html" })',
    '  response.end("<!doctype html><title>Release check</title><h1>It works</h1>")',
    `}).listen(${port}, "127.0.0.1")`,
    "",
  ].join("\n")
}

/** How the check sets the project up: no prompts, no install (the tarballs are installed), Stripe. */
const INIT_FLAGS = [
  "--yes",
  "--engine",
  "web",
  "--model-source",
  "none",
  "--providers",
  "stripe",
  "--skills",
  "claude",
  "--dev-command",
  "node app.mts",
  "--skip-install",
]

/** A test that types the Stripe fixtures, for the strict type check. */
const TYPED_TEST = [
  'import { type StripeFixtures, test as base } from "@danwo/sdk"',
  "",
  "const test = base.extend<StripeFixtures>()",
  "",
  'test("the home page answers", async ({ app, expect }) => {',
  '  const response = await fetch(new URL("/", app.baseUrl))',
  "",
  "  expect(response.ok).toBe(true)",
  "}).invariant(async ({ stripe, expect }) => {",
  "  expect(stripe).toBeDefined()",
  "})",
  "",
].join("\n")

/** The strictest options a user's tsconfig is likely to have; `tsc` must find no error. */
const STRICT_TSCONFIG = {
  compilerOptions: {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    module: "nodenext",
    target: "es2024",
    types: ["node"],
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.ts"],
}

/** An ES module project beside the check project, holding the files init wrote and a typed test. */
function writeTypedProject(dir: string): void {
  const typed = join(dir, "typed")

  mkdirSync(join(typed, "tests"), { recursive: true })
  writeFileSync(
    join(typed, "package.json"),
    `${JSON.stringify({ private: true, type: "module" })}\n`,
  )
  writeFileSync(join(typed, "tsconfig.json"), `${JSON.stringify(STRICT_TSCONFIG, null, 2)}\n`)
  cpSync(join(dir, "danwo.config.ts"), join(typed, "danwo.config.ts"))
  cpSync(join(dir, "tests", "example.danwo.ts"), join(typed, "tests", "example.danwo.ts"))
  writeFileSync(join(typed, "tests", "stripe.danwo.ts"), TYPED_TEST)
}

/** The TypeScript range the repository builds with, for the type check. */
function typescriptRange(): string {
  const root: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  const range: unknown = Reflect.get(
    Object(Reflect.get(Object(root), "devDependencies")),
    "typescript",
  )

  return typeof range === "string" ? range : "latest"
}

/**
 * Installs the tarballs into a fresh CommonJS npm project (what `npm init -y` writes) and runs
 * danwo there as a user would. Keeps the project when a step fails, to look at.
 */
async function verify(packed: readonly Packed[], version: string): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), "danwo-release-check-"))
  const port = await freePort()
  const npx = ["npx", "--no", "--"]

  console.log(`\nChecking the tarballs in a fresh project: ${dir}`)
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "release-check", version: "1.0.0", type: "commonjs" }, null, 2)}\n`,
  )
  writeFileSync(join(dir, "app.mts"), appSource(port))

  const steps: readonly CheckStep[] = [
    {
      label: "npm install the tarballs",
      argv: [
        "npm",
        "install",
        "--no-audit",
        "--no-fund",
        ...packed.map((tarball) => tarball.file),
        `typescript@${typescriptRange()}`,
        "@types/node@^24",
      ],
    },
    {
      label: "npx @danwo/cli --version",
      argv: [...npx, "@danwo/cli", "--version"],
      expected: version,
    },
    {
      label: "npx @danwo/cli init --yes …",
      argv: [...npx, "@danwo/cli", "init", ...INIT_FLAGS, "--app-url", `http://127.0.0.1:${port}`],
    },
    { label: "npx @danwo/cli test", argv: [...npx, "@danwo/cli", "test"] },
    {
      label: "npx tsc --noEmit (strict, nodenext)",
      argv: [...npx, "tsc", "--noEmit", "-p", "typed"],
      before: () => writeTypedProject(dir),
    },
  ]
  const passed = steps.every((check) => {
    check.before?.()

    return step(check, dir)
  })
  const ok = (await nothingLeftRunning(dir)) && passed

  if (ok) remove(dir)
  else console.log(`\nThe check project is kept at ${dir}`)

  return ok
}

/** Publishes the tarballs, each after the packages it depends on. */
function publish(packed: readonly Packed[], manifests: readonly Manifest[], version: string): void {
  const byName = new Map(packed.map((tarball) => [tarball.name, tarball]))
  const tag = distTag(version)

  for (const name of publishOrder(manifests)) {
    const tarball = byName.get(name)

    if (tarball === undefined) throw new Error(`${name} was not packed`)
    run("npm", ["publish", tarball.file, "--provenance", "--access", "public", "--tag", tag], ROOT)
  }
}

/** Stages the packages at `version` in a temporary folder and packs them into a clean `out`. */
function packAll(packages: readonly WorkspacePackage[], version: string, out: string): Packed[] {
  const stageDir = mkdtempSync(join(tmpdir(), "danwo-release-stage-"))

  remove(out)
  mkdirSync(out, { recursive: true })

  try {
    stage(packages, version, stageDir)

    return pack(packages, stageDir, out)
  } finally {
    remove(stageDir)
  }
}

/** Checks the tarballs when asked, then publishes them when asked; the exit code. */
async function afterPacking(
  args: ReleaseArgs,
  packed: readonly Packed[],
  manifests: readonly Manifest[],
): Promise<number> {
  if (args.verify && !(await verify(packed, args.version))) return 1
  if (args.mode === "publish") publish(packed, manifests, args.version)

  return 0
}

async function main(): Promise<number> {
  const args = parseReleaseArgs(process.argv.slice(2))
  const packages = workspacePackages()
  const gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
  const problems = refusals({ version: args.version, gitStatus, packages })

  if (problems.length > 0) {
    console.error(`Not releasing ${args.version}:\n  ${problems.join("\n  ")}`)

    return 1
  }

  const released = publicPackages(packages)
  const out = resolve(ROOT, args.out)

  build()

  const packed = packAll(released, args.version, out)

  console.log(`\n${summaryLines(packed, out).join("\n")}`)

  return afterPacking(
    args,
    packed,
    released.map((pkg) => pkg.manifest),
  )
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
