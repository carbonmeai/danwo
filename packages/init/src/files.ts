/**
 * The project files `danwo init` touches and how: a config is replaced only when asked, an
 * example test is never overwritten, and `package.json`, `.gitignore` and `.env.example` only
 * gain what they lack. Running init again with the same answers changes nothing.
 */
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, posix } from "node:path"

import type { Answers } from "./answers.ts"
import type { Detection } from "./detect.ts"
import {
  envExampleNames,
  renderApiTest,
  renderMobileConfig,
  renderMobileTest,
  renderWebConfig,
  renderWebTest,
  testDirs,
} from "./render.ts"
import { isRecord } from "./workspace.ts"

/**
 * How a file may change: `merge` files always take their additions, a `guarded` file is replaced
 * only with permission, and a `create` file is written only when it is not there.
 */
export type FileMode = "merge" | "guarded" | "create"

export interface PlannedFile {
  /** Relative to the project. */
  readonly file: string
  readonly before: string | undefined
  readonly after: string
  readonly mode: FileMode
}

/** `kept`: the file differs and was left as it is (an edited config, an existing test). */
export type FileOutcome = "created" | "updated" | "unchanged" | "kept"

export interface FileResult {
  readonly file: string
  readonly outcome: FileOutcome
  readonly mode: FileMode
}

const CONFIG_FILE = "danwo.config.ts"
const MOBILE_CONFIG_FILE = "danwo.mobile.config.ts"
const EXAMPLE_TEST = "example.danwo.ts"

async function readText(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, "utf8") : undefined
}

/** Whether `dir` already holds a danwo test, so no example is added beside it. */
async function hasTests(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false

  const entries = await readdir(dir, { recursive: true })

  return entries.some((entry) => entry.endsWith(".danwo.ts") && !entry.endsWith(EXAMPLE_TEST))
}

/** The config and example test for each engine the answers pick, by file. */
function engineFiles(answers: Answers, detection: Detection): Map<string, string> {
  const dirs = testDirs(answers)
  const files = new Map<string, string>()
  const web = answers.engine !== "mobile"
  const mobile = answers.engine === "mobile" || answers.engine === "both"

  if (web) {
    files.set(CONFIG_FILE, renderWebConfig(answers, dirs.web))
    files.set(
      posix.join(dirs.web, EXAMPLE_TEST),
      answers.engine === "none" ? renderApiTest(answers) : renderWebTest(answers),
    )
  }

  if (mobile) {
    files.set(
      web ? MOBILE_CONFIG_FILE : CONFIG_FILE,
      renderMobileConfig(answers, detection, dirs.mobile),
    )
    files.set(posix.join(dirs.mobile, EXAMPLE_TEST), renderMobileTest(answers))
  }

  return files
}

/** The scripts that run the tests: one per config. */
export function testScripts(answers: Pick<Answers, "engine">): Record<string, string> {
  return answers.engine === "both"
    ? {
        "test:danwo": "danwo test",
        "test:danwo:mobile": `danwo test --config ${MOBILE_CONFIG_FILE}`,
      }
    : { "test:danwo": "danwo test" }
}

/** The indent a JSON file uses, so a rewrite keeps it. */
function indentOf(text: string): string {
  return /\n([ \t]+)"/.exec(text)?.[1] ?? "  "
}

/** `package.json` with the test scripts it lacks; scripts already there are left alone. */
export function mergedPackageJson(
  before: string | undefined,
  name: string,
  scripts: Readonly<Record<string, string>>,
): string {
  const parsed: unknown = before === undefined ? { name, private: true } : JSON.parse(before)

  if (!isRecord(parsed))
    throw new Error("package.json is not a JSON object; fix it, then run danwo init again")

  const current = parsed["scripts"]
  const existing = isRecord(current) ? current : {}
  const missing = Object.entries(scripts).filter(([key]) => !(key in existing))

  if (before !== undefined && missing.length === 0) return before

  const merged = { ...parsed, scripts: { ...existing, ...Object.fromEntries(missing) } }

  return `${JSON.stringify(merged, null, before === undefined ? "  " : indentOf(before))}\n`
}

/** `text` with `lines` appended that it does not already have, or `text` itself. */
export function withLines(
  text: string | undefined,
  lines: readonly string[],
  has: (existing: readonly string[], line: string) => boolean,
): string | undefined {
  const existing = (text ?? "").split("\n").map((line) => line.trim())
  const missing = lines.filter((line) => !has(existing, line))

  if (missing.length === 0) return text

  const kept = (text ?? "").replace(/\n*$/, "")

  return `${kept === "" ? "" : `${kept}\n`}${missing.join("\n")}\n`
}

/** Whether a `.gitignore` already leaves out danwo's run folder. */
function ignoresDanwo(existing: readonly string[]): boolean {
  return existing.some((line) => /^\/?\.danwo\/?$/.test(line))
}

/** Whether an env file already names the variable `line` sets. */
function namesVariable(existing: readonly string[], line: string): boolean {
  const name = line.split("=")[0] ?? line

  return existing.some((entry) => entry.startsWith(`${name}=`))
}

/** Every file init would write for `answers`, with what is there now. */
export async function planFiles(answers: Answers, detection: Detection): Promise<PlannedFile[]> {
  const root = detection.root
  const planned: PlannedFile[] = []

  const add = async (
    file: string,
    mode: FileMode,
    after: (before?: string) => string | undefined,
  ) => {
    const before = await readText(join(root, file))
    const text = after(before)

    if (text !== undefined) planned.push({ file, before, after: text, mode })
  }

  for (const [file, text] of engineFiles(answers, detection)) {
    const isTest = file.endsWith(EXAMPLE_TEST)

    if (isTest && (await hasTests(join(root, dirname(file))))) continue
    await add(file, isTest ? "create" : "guarded", () => text)
  }

  await add("package.json", "merge", (before) =>
    mergedPackageJson(before, detection.name, testScripts(answers)),
  )
  await add(".gitignore", "merge", (before) =>
    withLines(before, [".danwo/"], (existing) => ignoresDanwo(existing)),
  )
  await add(".env.example", "merge", (before) =>
    withLines(
      before,
      envExampleNames(answers).map((name) => `${name}=`),
      namesVariable,
    ),
  )

  return planned
}

/** What writing `file` comes to, given whether a guarded file may be replaced. */
function outcomeOf(file: PlannedFile, replaceGuarded: boolean): FileOutcome {
  if (file.before === undefined) return "created"
  if (file.before === file.after) return "unchanged"
  if (file.mode === "create" || (file.mode === "guarded" && !replaceGuarded)) return "kept"

  return "updated"
}

/** Writes the planned files and says what happened to each. */
export async function writeFiles(
  root: string,
  planned: readonly PlannedFile[],
  replaceGuarded: boolean,
): Promise<FileResult[]> {
  const results: FileResult[] = []

  for (const file of planned) {
    const outcome = outcomeOf(file, replaceGuarded)

    if (outcome === "created" || outcome === "updated") {
      await mkdir(dirname(join(root, file.file)), { recursive: true })
      await writeFile(join(root, file.file), file.after)
    }

    results.push({ file: file.file, outcome, mode: file.mode })
  }

  return results
}

/** A guarded file that exists and would change: what init asks about before replacing it. */
export function conflicts(planned: readonly PlannedFile[]): PlannedFile[] {
  return planned.filter(
    (file) => file.mode === "guarded" && file.before !== undefined && file.before !== file.after,
  )
}
