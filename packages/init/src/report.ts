/**
 * What `danwo init` says when it is done: each file and what happened to it, the packages, and
 * the next commands. Plain text, so it reads the same in a terminal and in a coding agent's log.
 */
import type { Answers } from "./answers.ts"
import { MODEL_SOURCE_INFO, providerList } from "./catalog.ts"
import { type Detection, keyFound, runScript } from "./detect.ts"
import { browserCommand, commandLine, type InstallResult, installCommand } from "./install.ts"
import { modelKeyEnv } from "./render.ts"
import type { SetupResult } from "./setup.ts"

/** Why a file was kept, by how it may change. */
const KEPT_NOTES: Readonly<Record<string, string>> = {
  guarded: " (it differs from what init writes; --force replaces it)",
  create: " (already there)",
}

function fileLines(results: readonly { file: string; outcome: string; mode?: string }[]): string[] {
  return results.map((result) => {
    const note =
      result.outcome === "kept"
        ? (KEPT_NOTES[result.mode ?? ""] ?? " (edited here; left as it is)")
        : ""

    return `  ${result.outcome.padEnd(9)} ${result.file}${note}`
  })
}

/** An install's line: what ran, and the tail of its output when it failed. */
function resultLines(label: string, result: InstallResult): string[] {
  if (result.ok) return [`  ${label}: ${result.command}`]

  return [`  failed: ${result.command}`, ...result.output.split("\n").map((line) => `    ${line}`)]
}

function packageLines(result: SetupResult, detection: Detection): string[] {
  const { install, notInstalled, browser } = result
  const browserLines = browser === undefined ? [] : resultLines("browser", browser)

  if (notInstalled.length > 0)
    return [
      `  not installed: run ${commandLine(installCommand(detection, notInstalled), detection.root)}`,
    ]
  if (install === undefined) return ["  nothing to add", ...browserLines]

  return [...resultLines("added", install), ...browserLines]
}

/** Where the model's key stands, by name only. */
export function keyLine(
  answers: Answers,
  detection: Pick<Detection, "envNames">,
): string | undefined {
  const keyEnv = modelKeyEnv(answers)

  if (answers.modelSource === "none") return "No model: add one to the config to use agent steps."
  if (keyEnv === undefined)
    return `The model runs on ${answers.baseUrl ?? "your server"}; no key needed.`
  if (keyFound(detection, keyEnv))
    return `${keyEnv} is set; agent steps use ${answers.model ?? ""}.`

  return `Set ${keyEnv} for ${MODEL_SOURCE_INFO[answers.modelSource].label}: export it in your shell, or keep it in a .env file your test command loads (danwo reads none of its own).`
}

/** The steps that ready the machine: Android's check, and the browser when init did not install it. */
function machineSteps(answers: Answers, detection: Detection, result: SetupResult): string[] {
  const mobile = answers.engine === "mobile" || answers.engine === "both"
  const web = answers.engine === "web" || answers.engine === "both"
  const browser = browserCommand(detection, answers.browsers).argv.join(" ")
  const which =
    answers.browsers.length === 1 && answers.browsers[0] === "chromium"
      ? "the Chromium"
      : "the browsers"

  return [
    ...(mobile
      ? ["Check this machine for Android testing: danwo device doctor (danwo guide mobile)."]
      : []),
    ...(web && result.browser?.ok !== true
      ? [`Install ${which} danwo drives, once per machine: ${browser} (--with-deps on Linux)`]
      : []),
  ]
}

function nextSteps(answers: Answers, detection: Detection, result: SetupResult): string[] {
  const run = runScript(detection.packageManager, "test:danwo")
  const steps: string[] = []
  const key = keyLine(answers, detection)
  const emulated = providerList(answers.providers)

  if (key !== undefined) steps.push(key)
  steps.push(...machineSteps(answers, detection, result))
  if (answers.engine !== "mobile") {
    steps.push(
      `Run the example: ${run}. danwo starts \`${answers.devCommand}\` at ${answers.appUrl}${emulated === "" ? "" : ` with ${emulated} emulated`}.`,
    )
    steps.push(`Test an app you already run: APP_URL=${answers.appUrl} ${run}`)
  } else steps.push(`Run the example: ${run}`)
  steps.push("Read on: danwo guide first-test · danwo guide providers · danwo guide matrix")

  return steps.map((step, index) => `  ${index + 1}. ${step}`)
}

/** The report printed when init is done. */
export function initSummary(answers: Answers, detection: Detection, result: SetupResult): string {
  return [
    "Files",
    ...fileLines(result.files),
    ...(result.agentFiles.length > 0 ? ["", "Coding agents", ...fileLines(result.agentFiles)] : []),
    "",
    "Packages",
    ...packageLines(result, detection),
    "",
    "Next",
    ...nextSteps(answers, detection, result),
  ].join("\n")
}
