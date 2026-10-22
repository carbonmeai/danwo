/**
 * The danwo build of a native iOS app (SwiftUI or UIKit, no Expo): `xcodebuild` builds the scheme
 * for the iOS Simulator, unsigned, into a derived-data folder of danwo's own, and the `.app` is kept
 * by a hash of the project's sources. The kept app's App Transport Security is opened for plain
 * HTTP, as the Expo build's is; HTTPS needs nothing, since danwo trusts its CA in the simulator.
 */
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { DANWO_TRANSPORT_SECURITY } from "./ios-network.ts"
import type { XcodeContainer } from "./project.ts"
import { type BuildExec, buildSlot, type BuildSlot, type IosBuild, sourceHash } from "./slot.ts"

/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-xcode-1"

/**
 * What an Xcode project's build or install writes, never part of its key: build folders,
 * CocoaPods' `Pods`, and Xcode's per-user state.
 */
export const XCODE_OUTPUTS: ReadonlySet<string> = new Set([
  "build",
  "DerivedData",
  "Pods",
  "xcuserdata",
  "node_modules",
])

/** Options of a native iOS build. */
export interface XcodeBuildOptions {
  readonly project: string
  readonly container: XcodeContainer
  /** The scheme to build; found from the project when it has one, or one named after it. */
  readonly scheme?: string | undefined
  /** The build configuration; default `Release`. */
  readonly configuration?: string | undefined
  readonly force?: boolean | undefined
  readonly onLine?: ((line: string) => void) | undefined
  readonly exec?: BuildExec | undefined
  /** The tools' environment; this Mac's by default. */
  readonly env?: NodeJS.ProcessEnv | undefined
}

/** The schemes `xcodebuild -list -json` printed, for a project or a workspace. */
export function schemesOf(listing: string): string[] {
  const parsed: unknown = JSON.parse(listing)
  const holder: unknown =
    Reflect.get(Object(parsed), "project") ?? Reflect.get(Object(parsed), "workspace")
  const schemes: unknown = Reflect.get(Object(holder), "schemes")

  return Array.isArray(schemes) ? schemes.map(String) : []
}

/**
 * The scheme to build: the one asked for, else the only one, else the one named like the project
 * or workspace (`Hello` for `Hello.xcodeproj`, as Xcode names an app's scheme).
 */
export function pickScheme(
  schemes: readonly string[],
  container: XcodeContainer,
  wanted?: string,
): string {
  if (wanted !== undefined) {
    if (!schemes.includes(wanted))
      throw new Error(
        `${container.file} has no scheme ${wanted}; its schemes: ${schemes.join(", ") || "none"}`,
      )

    return wanted
  }

  if (schemes.length === 1 && schemes[0] !== undefined) return schemes[0]
  if (schemes.includes(container.name)) return container.name

  throw new Error(
    schemes.length === 0
      ? `${container.file} has no shared scheme: share one in Xcode (Product › Scheme › Manage Schemes › Shared), or pass --scheme`
      : `${container.file} has several schemes (${schemes.join(", ")}): pass --scheme`,
  )
}

/** The `xcodebuild` arguments for an unsigned simulator build of `scheme`, for this Mac's CPU only. */
export function nativeXcodebuildArgs(options: {
  readonly container: XcodeContainer
  readonly scheme: string
  readonly configuration: string
  readonly derivedData: string
  readonly arch: string
}): string[] {
  return [
    options.container.kind === "workspace" ? "-workspace" : "-project",
    options.container.file,
    "-scheme",
    options.scheme,
    "-configuration",
    options.configuration,
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    options.derivedData,
    `ARCHS=${options.arch === "x64" ? "x86_64" : "arm64"}`,
    "CODE_SIGNING_ALLOWED=NO",
    "COMPILER_INDEX_STORE_ENABLE=NO",
    "build",
  ]
}

/** The app among a build's products: the scheme's own, else the only one. */
async function productApp(products: string, scheme: string): Promise<string> {
  const apps = existsSync(products)
    ? (await readdir(products)).filter((entry) => entry.endsWith(".app"))
    : []

  if (apps.includes(`${scheme}.app`)) return join(products, `${scheme}.app`)
  if (apps.length === 1 && apps[0] !== undefined) return join(products, apps[0])

  throw new Error(
    apps.length === 0
      ? `the build made no .app in ${products}`
      : `the build made several apps in ${products} (${apps.join(", ")}): pass --scheme`,
  )
}

/** The environment `xcodebuild` and CocoaPods run in. */
export function iosBuildEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "darwin") throw new Error("iOS builds need a Mac with Xcode")

  return {
    ...process.env,
    DANWO: "1",
    CI: "1",
    /* CocoaPods refuses to run in a non-UTF-8 locale. */
    LANG: process.env.LANG ?? "en_US.UTF-8",
  }
}

/** What every simulator build is given, whatever made the app. */
export interface SimulatorBuildOptions {
  readonly project: string
  readonly force?: boolean | undefined
  readonly onLine?: ((line: string) => void) | undefined
  readonly exec?: BuildExec | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
}

/**
 * The slot of a simulator app kept as `<key>.app`, and what the build reports once the app is
 * there: where it is, its bundle id, whether it was kept from before, and how long it took.
 */
export async function simulatorSlot(
  options: SimulatorBuildOptions,
  key: string,
  started: number,
): Promise<{ readonly slot: BuildSlot; readonly done: (cached: boolean) => Promise<IosBuild> }> {
  const mark = randomUUID()
  const slot = await buildSlot({
    project: options.project,
    force: options.force,
    onLine: options.onLine,
    exec: options.exec,
    file: `${key}.app`,
    logName: "build-ios.log",
    env: () => ({ ...(options.env ?? iosBuildEnv()), [BUILD_MARK]: mark }),
  })

  return {
    slot,
    done: async (cached) => {
      if (!cached && options.exec === undefined) await stopInterfaceBuilder(mark)

      return {
        app: slot.path,
        bundleId: await bundleIdOf(slot, slot.path),
        cached,
        durationMs: Date.now() - started,
        log: slot.log,
      }
    },
  }
}

/**
 * The variable that marks one build's environment. Interface Builder's daemons, which compile an
 * app's storyboards, inherit the environment of the build that started them.
 */
const BUILD_MARK = "DANWO_IOS_BUILD"

/**
 * The Interface Builder daemons in a `ps -E -A -ww -o pid=,command=` listing (each command followed
 * by its environment) that the build marked `mark` started. They lead process groups of their own,
 * so ending the build does not end them.
 */
export function interfaceBuilderDaemons(listing: string, mark: string): number[] {
  return listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)

    if (match?.[1] === undefined || match[2] === undefined) return []

    const command = match[2]
    const daemon = /\/ibtoold(\s|$)/.test(command) && command.includes(`${BUILD_MARK}=${mark}`)

    return daemon ? [Number(match[1])] : []
  })
}

/**
 * Ends the Interface Builder daemons the build marked `mark` left behind: they would idle for
 * minutes after the build, and danwo leaves nothing running.
 */
async function stopInterfaceBuilder(mark: string): Promise<void> {
  const listing = await new Promise<string>((resolve) => {
    execFile(
      "ps",
      ["-E", "-A", "-ww", "-o", "pid=,command="],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve(error ? "" : stdout),
    )
  })

  for (const pid of interfaceBuilderDaemons(listing, mark)) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      /* It ended on its own meanwhile. */
    }
  }
}

/** The bundle id in a built app's Info.plist. */
async function bundleIdOf(slot: Pick<BuildSlot, "step">, app: string): Promise<string> {
  const id = await slot.step("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    join(app, "Info.plist"),
  ])

  return id.trim()
}

/** Lets the kept app make plain HTTP calls, as the Expo build does; see `DANWO_TRANSPORT_SECURITY`. */
export async function openTransportSecurity(
  slot: Pick<BuildSlot, "step">,
  app: string,
): Promise<void> {
  await slot.step("plutil", [
    "-replace",
    "NSAppTransportSecurity",
    "-json",
    JSON.stringify(DANWO_TRANSPORT_SECURITY),
    join(app, "Info.plist"),
  ])
}

/** Builds the native app in `options.project` for the simulator, or returns the kept build. */
export async function buildXcode(options: XcodeBuildOptions): Promise<IosBuild> {
  const started = Date.now()
  const { project, container } = options
  const configuration = options.configuration ?? "Release"
  const recipe = `${RECIPE}:${options.scheme ?? ""}:${configuration}`
  const { slot, done } = await simulatorSlot(
    options,
    await sourceHash(project, recipe, XCODE_OUTPUTS),
    started,
  )
  const app = slot.path

  if (slot.reuse) return done(true)

  if (
    container.kind === "workspace" &&
    existsSync(join(project, "Podfile")) &&
    !existsSync(join(project, "Pods"))
  )
    await slot.step("pod", ["install"])

  const scheme = pickScheme(
    schemesOf(
      await slot.step("xcodebuild", ["-list", "-json", `-${container.kind}`, container.file]),
    ),
    container,
    options.scheme,
  )
  const derivedData = join(project, ".danwo", "xcode")

  await slot.step(
    "xcodebuild",
    nativeXcodebuildArgs({ container, scheme, configuration, derivedData, arch: process.arch }),
  )

  const built = await productApp(
    join(derivedData, "Build", "Products", `${configuration}-iphonesimulator`),
    scheme,
  )

  await rm(app, { recursive: true, force: true })
  await cp(built, app, { recursive: true, verbatimSymlinks: true })
  await openTransportSecurity(slot, app)

  return done(false)
}
