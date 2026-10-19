/**
 * Runs `playwright test` for one matrix trial: one worker, no retries, the trial's fault and
 * outcome file in its environment. Playwright's own CLI is the one the project installed.
 */
import { createRequire } from "node:module"
import { join } from "node:path"

import { spawnOwned } from "@danwo/runner/children"

import { OUTCOME_FILE, TRIAL_FAULT } from "./protocol.ts"

export interface PlaywrightRun {
  readonly spec: string
  readonly grep?: string | undefined
  readonly config?: string | undefined
  readonly cwd?: string | undefined
  readonly outcomeFile: string
  /** Playwright's output folder for this trial, so one trial's results outlive the next. */
  readonly outputDir: string
  /** The fault the trial arms, by label; none for the clean trial. */
  readonly fault?: string | undefined
}

/** The project's Playwright Test CLI. */
function playwrightCli(cwd: string): string {
  return createRequire(join(cwd, "package.json")).resolve("@playwright/test/cli")
}

function argsOf(run: PlaywrightRun): string[] {
  return [
    "test",
    run.spec,
    "--workers=1",
    "--retries=0",
    "--reporter=line",
    `--output=${run.outputDir}`,
    ...(run.grep === undefined ? [] : ["--grep", run.grep]),
    ...(run.config === undefined ? [] : ["--config", run.config]),
  ]
}

function environmentOf(run: PlaywrightRun): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, [OUTCOME_FILE]: run.outcomeFile }

  if (run.fault === undefined) delete env[TRIAL_FAULT]
  else env[TRIAL_FAULT] = run.fault

  return env
}

/** Runs the trial; resolves with Playwright's output once it exits, whatever its exit code. */
export function runPlaywright(run: PlaywrightRun): Promise<string> {
  const cwd = run.cwd ?? process.cwd()

  return new Promise((resolve, reject) => {
    /* Owned: Playwright's workers and browsers go with it if this process ends first. */
    const { child } = spawnOwned(process.execPath, [playwrightCli(cwd), ...argsOf(run)], {
      cwd,
      env: environmentOf(run),
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""

    const collect = (chunk: Buffer) => {
      output += chunk.toString()
    }

    child.stdout?.on("data", collect)
    child.stderr?.on("data", collect)
    child.once("error", reject)
    child.once("close", () => resolve(output))
  })
}
