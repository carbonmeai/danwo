/**
 * The packages the written files import, added with the project's own package manager. A
 * package already among the project's dependencies is left as it is.
 */
import { spawn } from "node:child_process"

import type { Answers } from "./answers.ts"
import {
  DANWO_PACKAGES,
  MOBILE_PACKAGES,
  MODEL_SOURCE_INFO,
  NODE_TYPES,
  type PackageSpec,
} from "./catalog.ts"
import type { Detection, PackageManager } from "./detect.ts"

/**
 * The packages the answers' files import that the project does not have yet, plus Node's types in
 * a TypeScript project, since danwo's declarations use them.
 */
export function packagesToAdd(
  answers: Pick<Answers, "engine" | "modelSource">,
  detection: Pick<Detection, "dependencies" | "typescript">,
): PackageSpec[] {
  const model = MODEL_SOURCE_INFO[answers.modelSource].package
  const mobile = answers.engine === "mobile" || answers.engine === "both"
  const wanted = [
    ...DANWO_PACKAGES,
    ...(model ? [model] : []),
    ...(mobile ? MOBILE_PACKAGES : []),
    ...(detection.typescript ? [NODE_TYPES] : []),
  ]

  return wanted.filter((spec) => !detection.dependencies.has(spec.name))
}

/** The command that adds `packages` as dev dependencies with `pm`. */
export function installCommand(pm: PackageManager, packages: readonly PackageSpec[]): string[] {
  const specs = packages.map((spec) =>
    spec.version === "latest" ? spec.name : `${spec.name}@${spec.version}`,
  )
  const add = {
    bun: ["add", "-d"],
    pnpm: ["add", "-D"],
    yarn: ["add", "-D"],
    npm: ["install", "-D"],
  }

  return [pm, ...add[pm], ...specs]
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
    const child = spawn(program, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
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

/** Adds `packages` to the project in `cwd` with `pm`. */
export async function installPackages(
  cwd: string,
  pm: PackageManager,
  packages: readonly PackageSpec[],
  run: Runner = runCommand,
): Promise<InstallResult> {
  const argv = installCommand(pm, packages)
  const { ok, output } = await run(argv, cwd)

  return {
    command: argv.join(" "),
    ok,
    output: ok ? "" : output.trim().split("\n").slice(-8).join("\n"),
  }
}
