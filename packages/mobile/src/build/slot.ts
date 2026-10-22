/**
 * What every danwo build shares, whatever the project: a key made from the sources, the folder the
 * builds are kept in (`<project>/.danwo/builds/`), the log, and how the build's tools run.
 */
import { createHash } from "node:crypto"
import { createWriteStream, existsSync } from "node:fs"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { spawnOwned } from "@danwo/runner/children"
import { spawnPlan } from "@danwo/runner/command-line"

/**
 * Folders an Expo app generates or installs, never part of its build's key: `expo prebuild`
 * writes `android/` and `ios/` afresh, so they are outputs here.
 */
const EXPO_OUTPUTS: ReadonlySet<string> = new Set([
  "node_modules",
  "android",
  "ios",
  "dist",
  "build",
])

/** The recipe of the Expo Android build, the default key's prefix. */
const EXPO_ANDROID_RECIPE = "danwo-android-1"

async function sourceFiles(
  dir: string,
  root: string,
  outputs: ReadonlySet<string>,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      /* Dotfiles are tool state (`.gradle`, `.dart_tool`, `.expo`) and the kept builds (`.danwo`). */
      .filter((entry) => !outputs.has(entry.name) && !entry.name.startsWith("."))
      .map(async (entry) => {
        const path = join(dir, entry.name)

        /* Forward slashes, so a build key is the same on every platform. */
        return entry.isDirectory()
          ? sourceFiles(path, root, outputs)
          : [relative(root, path).split("\\").join("/")]
      }),
  )

  return nested.flat().toSorted()
}

/**
 * The build's key: the recipe and every source file's path and bytes. `outputs` names the folders
 * and files, at any depth, that a build or an install writes, which are left out.
 */
export async function sourceHash(
  project: string,
  recipe: string = EXPO_ANDROID_RECIPE,
  outputs: ReadonlySet<string> = EXPO_OUTPUTS,
): Promise<string> {
  const hash = createHash("sha256").update(recipe)

  for (const file of await sourceFiles(project, project, outputs)) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(join(project, file)))
      .update("\0")
  }

  return hash.digest("hex").slice(0, 16)
}

/** What `buildAndroid` produced. */
export interface AndroidBuild {
  /** The APK, kept under the project's `.danwo/builds/`. */
  readonly apk: string
  /** The app's package name, read from the APK (native and Flutter builds). */
  readonly package?: string
  /** True when an earlier build of the same sources was reused. */
  readonly cached: boolean
  readonly durationMs: number
  /** The build's full log. */
  readonly log: string
}

/** What `buildIos` produced. */
export interface IosBuild {
  /** The simulator app (`.app` folder), kept under the project's `.danwo/builds/`. */
  readonly app: string
  /** The app's bundle id, read from its Info.plist (native and Flutter builds). */
  readonly bundleId?: string
  /** True when an earlier build of the same sources was reused. */
  readonly cached: boolean
  readonly durationMs: number
  /** The build's full log. */
  readonly log: string
}

/** A build tool's name on `platform`: the Gradle wrapper is a batch file on Windows. */
export function windowsName(command: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" && command === "./gradlew" ? "gradlew.bat" : command
}

/** How a build runs one tool: in `cwd`, with `env`; resolves with what it printed to stdout. */
export type BuildExec = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
) => Promise<string>

/**
 * Runs a tool, appending its output to `log`; resolves with its stdout, and rejects with the tail
 * of its output on failure. The tool leads its own process group, so an interrupted build stops
 * what it started too.
 */
function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly log: string },
  onLine: ((line: string) => void) | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(options.log, { flags: "a" })
    const tail: string[] = []
    const stdout: Buffer[] = []
    /*
     * npm, npx and flutter are `.cmd` or `.bat` scripts on Windows, and the Gradle wrapper is
     * `gradlew.bat`: they start through cmd.exe there.
     */
    const plan = spawnPlan(windowsName(command), args)
    const { child } = spawnOwned(plan.command, plan.args, {
      cwd: options.cwd,
      env: options.env,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    })

    log.write(`$ ${command} ${args.join(" ")}\n`)

    const take = (chunk: Buffer) => {
      log.write(chunk)

      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim() === "") continue

        tail.push(line)
        if (tail.length > 30) tail.shift()

        onLine?.(line)
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk)
      take(chunk)
    })
    child.stderr?.on("data", take)
    child.on("error", reject)
    child.on("close", (code) => {
      log.end()

      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"))
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${tail.join("\n")}`))
    })
  })
}

/** Where one build is kept and logged, and how its tools run. */
export interface BuildSlot {
  /** The kept build: `<project>/.danwo/builds/<file>`. */
  readonly path: string
  /** `<project>/.danwo/builds/`, for what a build needs beside its output. */
  readonly dir: string
  readonly log: string
  /** True when a build of the same sources is kept and no build is asked for. */
  readonly reuse: boolean
  /** Runs a tool in the project (or `cwd`), its output appended to the log; its stdout. */
  readonly step: (command: string, args: readonly string[], cwd?: string) => Promise<string>
  /** Installs the project's packages when it has none yet. */
  readonly install: () => Promise<void>
}

/** The slot for a build of `project` kept as `file`, logged to `logName`. */
export async function buildSlot(options: {
  readonly project: string
  readonly file: string
  readonly logName: string
  readonly force?: boolean | undefined
  readonly onLine?: ((line: string) => void) | undefined
  /** The tools' environment, asked for only when a tool runs. */
  readonly env: () => NodeJS.ProcessEnv
  /** Runs the tools; tests pass a fake. */
  readonly exec?: BuildExec | undefined
}): Promise<BuildSlot> {
  const { project, onLine } = options
  const dir = join(project, ".danwo", "builds")
  const path = join(dir, options.file)
  const log = join(dir, options.logName)
  let env: NodeJS.ProcessEnv | undefined

  await mkdir(dir, { recursive: true })

  const step = (command: string, args: readonly string[], cwd = project) => {
    env ??= options.env()

    return options.exec === undefined
      ? run(command, args, { cwd, env, log }, onLine)
      : options.exec(command, args, { cwd, env })
  }

  return {
    path,
    dir,
    log,
    reuse: options.force !== true && existsSync(path),
    step,
    async install() {
      if (!existsSync(join(project, "node_modules")))
        await step("npm", ["install", "--no-audit", "--no-fund"])
    },
  }
}
