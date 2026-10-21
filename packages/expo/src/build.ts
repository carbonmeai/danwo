/**
 * `danwo build-android`: the danwo build of an Expo app, as a release APK with its JavaScript
 * bundled (no Metro at test time). Runs `expo prebuild`, applies the danwo network config, then
 * Gradle, with Android Studio's JDK when `JAVA_HOME` is unset. A build is kept by a hash of the
 * app's sources, so an unchanged app is not built again.
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream, existsSync } from "node:fs"
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { androidSdkRoot, javaHome } from "@danwo/device/toolchain"

import { applyNetworkConfig } from "./network.ts"

/** Options of `buildAndroid`. */
export interface BuildAndroidOptions {
  /** The Expo project's folder (where its package.json and app config are). */
  readonly project: string
  /** Build again even when a build of the same sources is kept. */
  readonly force?: boolean
  /** Each line the tools print; the build is quiet otherwise (the full log is kept on disk). */
  readonly onLine?: (line: string) => void
}

/** What `buildAndroid` produced. */
export interface AndroidBuild {
  /** The APK, kept under the project's `.danwo/builds/`. */
  readonly apk: string
  /** True when an earlier build of the same sources was reused. */
  readonly cached: boolean
  readonly durationMs: number
  /** The build's full log. */
  readonly log: string
}

/** Folders that are outputs or dependencies, not sources, and never part of the build's key. */
const NOT_SOURCES = new Set(["node_modules", "android", "ios", ".expo", ".danwo", "dist", "build"])
/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-android-1"

async function sourceFiles(dir: string, root: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((entry) => !NOT_SOURCES.has(entry.name) && !entry.name.startsWith("."))
      .map(async (entry) => {
        const path = join(dir, entry.name)

        return entry.isDirectory() ? sourceFiles(path, root) : [relative(root, path)]
      }),
  )

  return nested.flat().toSorted()
}

/** The build's key: the recipe and every source file's path and bytes. */
export async function sourceHash(project: string, recipe: string = RECIPE): Promise<string> {
  const hash = createHash("sha256").update(recipe)

  for (const file of await sourceFiles(project, project)) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(join(project, file)))
      .update("\0")
  }

  return hash.digest("hex").slice(0, 16)
}

/** Runs a tool, appending its output to `log`; rejects with the tail of its output on failure. */
function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly log: string },
  onLine: ((line: string) => void) | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(options.log, { flags: "a" })
    const tail: string[] = []
    const child = spawn(command, args, { cwd: options.cwd, env: options.env })

    const take = (chunk: Buffer) => {
      log.write(chunk)

      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim() === "") continue

        tail.push(line)
        if (tail.length > 30) tail.shift()

        onLine?.(line)
      }
    }

    child.stdout.on("data", take)
    child.stderr.on("data", take)
    child.on("error", reject)
    child.on("close", (code) => {
      log.end()

      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${tail.join("\n")}`))
    })
  })
}

/** The environment Gradle and Expo run in: the SDK, a JDK, and the danwo build switched on. */
function buildEnv(): NodeJS.ProcessEnv {
  const sdk = androidSdkRoot()
  const java = javaHome()

  if (sdk === undefined) throw new Error("no Android SDK found: set ANDROID_HOME")

  if (java === undefined) {
    throw new Error(
      "no JDK found: set JAVA_HOME, or install Android Studio (its bundled JDK works)",
    )
  }

  return {
    ...process.env,
    ANDROID_HOME: sdk,
    JAVA_HOME: java,
    DANWO: "1",
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
  }
}

/** Where one build is kept and logged, and how its tools run. */
export interface BuildSlot {
  /** The kept build: `<project>/.danwo/builds/<file>`. */
  readonly path: string
  readonly log: string
  /** True when a build of the same sources is kept and no build is asked for. */
  readonly reuse: boolean
  /** Runs a tool in the project (or `cwd`), its output appended to the log. */
  readonly step: (command: string, args: readonly string[], cwd?: string) => Promise<void>
  /** Installs the project's packages when it has none yet. */
  readonly install: () => Promise<void>
}

/** The slot for a build of `project` kept as `file`, logged to `logName`. */
export async function buildSlot(options: {
  readonly project: string
  readonly file: string
  readonly logName: string
  readonly force?: boolean
  readonly onLine?: (line: string) => void
  /** The tools' environment, asked for only when a build runs. */
  readonly env: () => NodeJS.ProcessEnv
}): Promise<BuildSlot> {
  const { project, onLine } = options
  const builds = join(project, ".danwo", "builds")
  const path = join(builds, options.file)
  const log = join(builds, options.logName)
  let env: NodeJS.ProcessEnv | undefined

  await mkdir(builds, { recursive: true })

  const step = (command: string, args: readonly string[], cwd = project) => {
    env ??= options.env()

    return run(command, args, { cwd, env, log }, onLine)
  }

  return {
    path,
    log,
    reuse: options.force !== true && existsSync(path),
    step,
    async install() {
      if (!existsSync(join(project, "node_modules")))
        await step("npm", ["install", "--no-audit", "--no-fund"])
    },
  }
}

/** Builds the danwo APK of the Expo app in `options.project`, or returns the kept one. */
export async function buildAndroid(options: BuildAndroidOptions): Promise<AndroidBuild> {
  const started = Date.now()
  const { project } = options
  const slot = await buildSlot({
    ...options,
    file: `${await sourceHash(project)}.apk`,
    logName: "build.log",
    env: buildEnv,
  })
  const { path: apk, log, step } = slot

  if (slot.reuse) return { apk, cached: true, durationMs: Date.now() - started, log }

  await slot.install()
  await step("npx", ["expo", "prebuild", "--platform", "android", "--no-install"])
  await applyNetworkConfig(join(project, "android"))
  await step("./gradlew", ["assembleRelease", "--console=plain"], join(project, "android"))
  await copyFile(
    join(project, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    apk,
  )

  return { apk, cached: false, durationMs: Date.now() - started, log }
}
