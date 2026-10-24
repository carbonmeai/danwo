/**
 * The packages the written files import, added with the project's own package manager. A
 * package already among the project's dependencies is left as it is. In a workspace they go to the
 * project's own package.json, in the way the workspace's package manager takes them from there.
 */
import { spawn } from "node:child_process"
import { relative } from "node:path"

import { spawnPlan } from "@danwo/runner/command-line"

import type { Answers } from "./answers.ts"
import {
  AGENT_PACKAGES,
  DANWO_PACKAGES,
  MOBILE_PACKAGES,
  MODEL_SOURCE_INFO,
  NODE_TYPES,
  type PackageSpec,
} from "./catalog.ts"
import type { Detection, PackageManager } from "./detect.ts"

/**
 * The packages the answers' files import that the project does not have yet: danwo's own, the
 * device driver for a mobile engine, the MCP server and the recorder when coding agents are set
 * up, the AI SDK provider package of the model source picked, and Node's types in a TypeScript project,
 * since danwo's declarations use them.
 */
export function packagesToAdd(
  answers: Pick<Answers, "engine" | "modelSource" | "agents">,
  detection: Pick<Detection, "dependencies" | "typescript">,
): PackageSpec[] {
  const model = MODEL_SOURCE_INFO[answers.modelSource].package
  const mobile = answers.engine === "mobile" || answers.engine === "both"
  const wanted = [
    ...DANWO_PACKAGES,
    ...(mobile ? MOBILE_PACKAGES : []),
    ...(answers.agents.length > 0 ? AGENT_PACKAGES : []),
    ...(model ? [model] : []),
    ...(detection.typescript ? [NODE_TYPES] : []),
  ]

  return wanted.filter((spec) => !detection.dependencies.has(spec.name))
}

/** A command and the folder it runs in. */
export interface PlannedCommand {
  readonly argv: readonly string[]
  readonly cwd: string
}

const ADD: Readonly<Record<PackageManager, readonly string[]>> = {
  bun: ["add", "-d"],
  pnpm: ["add", "-D"],
  yarn: ["add", "-D"],
  npm: ["install", "-D"],
}

/**
 * The command that adds `packages` as dev dependencies of the project. A lone project, and a
 * package of a pnpm, Yarn or Bun workspace, runs its manager's add where it is. At a workspace's
 * root, pnpm needs `-w` and Yarn 1 `-W` to add there. npm adds to a package of its workspace from
 * the root, with `--workspace <path>`.
 */
export function installCommand(
  detection: Pick<Detection, "root" | "packageManager" | "workspace">,
  packages: readonly PackageSpec[],
): PlannedCommand {
  const pm = detection.packageManager
  const specs = packages.map((spec) =>
    spec.version === "latest" ? spec.name : `${spec.name}@${spec.version}`,
  )
  const workspace = detection.workspace
  const argv = [pm, ...ADD[pm], ...specs]

  if (workspace === undefined) return { argv, cwd: detection.root }

  if (workspace.path === "") {
    const rootFlag = pm === "pnpm" ? ["-w"] : pm === "yarn" && !workspace.yarnBerry ? ["-W"] : []

    return { argv: [...argv, ...rootFlag], cwd: detection.root }
  }

  return pm === "npm"
    ? { argv: [...argv, "--workspace", workspace.path], cwd: workspace.root }
    : { argv, cwd: detection.root }
}

/**
 * How each package manager runs the project's danwo. A runner that falls back to the registry
 * names the scoped package, since `danwo` there is someone else's; `pnpm exec` and `yarn` only
 * run what the project installed.
 */
const DANWO: Readonly<Record<PackageManager, readonly string[]>> = {
  npm: ["npx", "@danwo/cli"],
  bun: ["bunx", "@danwo/cli"],
  pnpm: ["pnpm", "exec", "danwo"],
  yarn: ["yarn", "danwo"],
}

/**
 * The command that installs the browser builds danwo drives (Chromium, or the `browsers` the
 * project runs in), with the project's own danwo: its Playwright's builds, whatever other
 * Playwright the project has.
 */
export function browserCommand(
  detection: Pick<Detection, "root" | "packageManager">,
  browsers: readonly string[] = ["chromium"],
): PlannedCommand {
  const named = browsers.length === 1 && browsers[0] === "chromium" ? [] : browsers

  return {
    argv: [
      ...DANWO[detection.packageManager],
      "install-browser",
      ...(named.length > 0 ? ["--browser", named.join(",")] : []),
    ],
    cwd: detection.root,
  }
}

/** A planned command as a person would type it, from the project's folder. */
export function commandLine(command: PlannedCommand, from: string): string {
  /* Forward slashes: cmd.exe, PowerShell and every POSIX shell take them in `cd`. */
  const where = relative(from, command.cwd).split("\\").join("/")
  const line = command.argv.join(" ")

  return where === "" ? line : `(cd ${where} && ${line})`
}

/** How an install went: its command, and the output's tail when it failed. */
export interface InstallResult {
  readonly command: string
  readonly ok: boolean
  readonly output: string
}

/** Runs `argv` in `cwd`; resolves with whether it exited 0 and its last lines of output. */
export type Runner = (
  argv: readonly string[],
  cwd: string,
) => Promise<{ ok: boolean; output: string }>

/** Runs a command, keeping its output for the report. */
export const runCommand: Runner = (argv, cwd) =>
  new Promise((resolve) => {
    const [program = "", ...args] = argv
    /* On Windows the package manager is a `.cmd` script, started through cmd.exe. */
    const plan = spawnPlan(program, args)
    const child = spawn(plan.command, [...plan.args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    })
    let output = ""

    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4_000)
    }

    child.stdout.on("data", keep)
    child.stderr.on("data", keep)
    child.once("error", (error) => resolve({ ok: false, output: error.message }))
    child.once("close", (code) => resolve({ ok: code === 0, output }))
  })

/** Runs `command` and says how it went, from the project's folder `from`. */
export async function runPlanned(
  command: PlannedCommand,
  from: string,
  run: Runner = runCommand,
): Promise<InstallResult> {
  const { ok, output } = await run(command.argv, command.cwd)

  return {
    command: commandLine(command, from),
    ok,
    output: ok ? "" : output.trim().split(/\r?\n/).slice(-8).join("\n"),
  }
}

/** Adds `packages` to the project with its package manager. */
export function installPackages(
  detection: Pick<Detection, "root" | "packageManager" | "workspace">,
  packages: readonly PackageSpec[],
  run: Runner = runCommand,
): Promise<InstallResult> {
  return runPlanned(installCommand(detection, packages), detection.root, run)
}
