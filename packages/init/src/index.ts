/**
 * `danwo init`: sets danwo up in a project. It looks at the project, asks what to set up (or
 * takes flags and the detected defaults, for CI and coding agents), then writes the config, an
 * example test, the scripts and danwo's skill, and installs what they import.
 */
import { type Answers, answersFromFlags, type InitFlags } from "./answers.ts"
import { type Detection, detectProject, runScript } from "./detect.ts"
import { checkDevice as doctor, type DeviceCheck } from "./device.ts"
import { lineDiff } from "./diff.ts"
import { conflicts, type PlannedFile, planFiles } from "./files.ts"
import type { Runner } from "./install.ts"
import type { Prompter } from "./prompter.ts"
import { initSummary } from "./report.ts"
import { applyAnswers, type SetupResult } from "./setup.ts"
import { askAnswers } from "./wizard.ts"

export { type Answers, type InitFlags, InitUsageError } from "./answers.ts"
export { AGENTS, ENGINES, MODEL_SOURCES, PROVIDER_IDS } from "./catalog.ts"
export { type Detection, detectProject } from "./detect.ts"
export { InitCancelled, type Prompter, terminalPrompter } from "./prompter.ts"

export interface RunInitOptions {
  readonly cwd: string
  readonly flags: InitFlags
  /** Ask at `prompter`; without it, answer from the flags and the detected defaults. */
  readonly prompter?: Prompter
  /** Where model keys and provider variables are looked for; default `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Runs the package manager; replaced in tests. */
  readonly run?: Runner
  /** Checks the machine for Android testing; replaced in tests. */
  readonly checkDevice?: () => Promise<DeviceCheck>
}

export interface InitOutcome {
  readonly answers: Answers
  readonly result: SetupResult
  /** The report, as printed at the end. */
  readonly summary: string
}

/** Asks before replacing a config that would change, showing the change. */
async function confirmReplace(
  prompter: Prompter,
  planned: readonly PlannedFile[],
): Promise<boolean> {
  const changed = conflicts(planned)

  if (changed.length === 0) return false
  for (const file of changed) prompter.note(lineDiff(file.before ?? "", file.after), file.file)

  return prompter.confirm(`Replace ${changed.map((file) => file.file).join(" and ")}?`, false)
}

/** The answers from flags alone, with the device check for a mobile engine. */
async function answersWithoutPrompts(
  detection: Detection,
  flags: InitFlags,
  checkDevice: () => Promise<DeviceCheck>,
): Promise<Answers> {
  const answers = answersFromFlags(detection, flags)

  if (answers.engine !== "mobile" && answers.engine !== "both") return answers

  return { ...answers, avd: (await checkDevice()).avd }
}

/** Sets danwo up in `options.cwd` and returns what it did. */
export async function runInit(options: RunInitOptions): Promise<InitOutcome> {
  const { prompter, flags } = options
  const checkDevice = options.checkDevice ?? doctor
  const detection = await detectProject(options.cwd, options.env)
  const asked = prompter
    ? await askAnswers(prompter, detection, flags, checkDevice)
    : await answersWithoutPrompts(detection, flags, checkDevice)
  const planned = await planFiles(asked, detection)
  const replaceConfig =
    asked.replaceConfig || (prompter !== undefined && (await confirmReplace(prompter, planned)))
  const answers = { ...asked, replaceConfig }
  const apply = () => applyAnswers(answers, detection, planned, options.run)
  const result = prompter
    ? await prompter.task("Writing the files", apply, () => "Files written")
    : await apply()
  const summary = initSummary(answers, detection, result)

  prompter?.note(summary, "danwo is set up")
  prompter?.outro(`Next: ${runScript(detection.packageManager, "test:danwo")}`)

  return { answers, result, summary }
}
