/**
 * What kind of app a folder holds, so `danwo build-ios` and `danwo build-android` know how to build
 * it: a Flutter app (`pubspec.yaml`), a native project (an Xcode workspace or project for iOS, a
 * Gradle build with its wrapper for Android), or else an Expo app (`package.json`).
 */
import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

/** An Xcode workspace or project at a folder's top, by its file name (`Hello.xcodeproj`). */
export interface XcodeContainer {
  readonly kind: "workspace" | "project"
  readonly file: string
  /** The name without its extension: `Hello`. */
  readonly name: string
}

/** An iOS project danwo can build. */
export type IosProject =
  | { readonly kind: "expo" }
  | { readonly kind: "flutter" }
  | { readonly kind: "xcode"; readonly container: XcodeContainer }

/** An Android project danwo can build. */
export type AndroidProject =
  | { readonly kind: "expo" }
  | { readonly kind: "flutter" }
  | { readonly kind: "gradle" }

/** A Gradle build's settings file, in either language. */
const GRADLE_SETTINGS = ["settings.gradle.kts", "settings.gradle"]

/**
 * The Xcode workspace at the top of `dir`, else its Xcode project. A workspace wins, since a
 * project with CocoaPods builds only through its workspace.
 */
export async function xcodeContainer(dir: string): Promise<XcodeContainer | undefined> {
  const entries = (await readdir(dir)).toSorted()
  const workspace = entries.find((entry) => entry.endsWith(".xcworkspace"))
  const project = entries.find((entry) => entry.endsWith(".xcodeproj"))

  if (workspace !== undefined)
    return { kind: "workspace", file: workspace, name: workspace.slice(0, -".xcworkspace".length) }
  if (project !== undefined)
    return { kind: "project", file: project, name: project.slice(0, -".xcodeproj".length) }

  return undefined
}

function flutter(dir: string): boolean {
  return existsSync(join(dir, "pubspec.yaml"))
}

function expo(dir: string): boolean {
  return existsSync(join(dir, "package.json"))
}

/** What `danwo build-ios` builds in `dir`; throws when it is none of them. */
export async function iosProject(dir: string): Promise<IosProject> {
  if (flutter(dir)) return { kind: "flutter" }

  const container = await xcodeContainer(dir)

  if (container !== undefined) return { kind: "xcode", container }
  if (expo(dir)) return { kind: "expo" }

  throw new Error(
    `${dir} holds no app to build for iOS: no Xcode workspace or project (.xcworkspace, .xcodeproj), no pubspec.yaml and no package.json`,
  )
}

/** What `danwo build-android` builds in `dir`; throws when it is none of them. */
export function androidProject(dir: string): AndroidProject {
  if (flutter(dir)) return { kind: "flutter" }

  if (GRADLE_SETTINGS.some((file) => existsSync(join(dir, file)))) {
    if (!existsSync(join(dir, "gradlew")))
      throw new Error(
        `${dir} is a Gradle build without its wrapper: add one with \`gradle wrapper\`, so the build uses the Gradle version the project was made for`,
      )

    return { kind: "gradle" }
  }

  if (expo(dir)) return { kind: "expo" }

  throw new Error(
    `${dir} holds no app to build for Android: no Gradle build (settings.gradle.kts and gradlew), no pubspec.yaml and no package.json`,
  )
}
