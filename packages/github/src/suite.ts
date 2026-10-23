/**
 * Which suite a run is, as GitHub shows it. A repository with several danwo suites reports each
 * under its own name: its check run (`danwo · dashboard`), its section of the pull request comment,
 * its job summary heading and the artifact its records are in. The name is the run's own
 * (`--name` or the config's `name`); without one, a repository whose git tracks several danwo
 * configs names each suite after its config's folder. A repository with one suite keeps the
 * unnamed check, section and artifact it always had.
 */
import { execFileSync } from "node:child_process"
import { relative, sep } from "node:path"

import type { RunContext, RunKind } from "@danwo/runner/runner"

/** The check run's name for each command when the suite has no name. */
const CHECK_NAMES: Readonly<Record<RunKind, string>> = {
  test: "danwo",
  matrix: "danwo matrix",
}

/** The artifact the records are in when the suite has no name. */
const DEFAULT_ARTIFACT = "danwo-runs"

/** Folder names that say where tests live rather than whose they are; a name skips past them. */
const GENERIC_FOLDERS = new Set([
  "e2e",
  "test",
  "tests",
  "spec",
  "specs",
  "integration",
  "danwo",
  "__tests__",
])

/** How a suite's runs are told apart from another suite's. */
export interface SuiteIdentity {
  /** The suite's name; undefined for a repository's one suite. */
  readonly name: string | undefined
  /** The name as a key and in an artifact's name: lower case, letters, digits and dashes. */
  readonly slug: string | undefined
  /** The artifact the workflow uploads this suite's `.danwo/runs` under. */
  readonly artifact: string
}

/** The danwo configs git tracks under `workspace`, as paths relative to it; none outside git. */
export function trackedConfigs(workspace: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "--", ":(glob)**/danwo.config.*"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter((path) => /(^|\/)danwo\.config\.(ts|mts|js|mjs)$/.test(path))
  } catch {
    return []
  }
}

/**
 * The suite's name from its config's folder: the last part of its path under the workspace that
 * is not a generic folder such as `e2e` (`packages/dashboard/e2e` → `dashboard`); none at the
 * workspace's root.
 */
export function folderSuiteName(root: string, workspace: string): string | undefined {
  const parts = relative(workspace, root)
    .split(sep)
    .filter((part) => part !== "" && part !== "..")

  return parts.findLast((part) => !GENERIC_FOLDERS.has(part.toLowerCase())) ?? parts.at(-1)
}

/** `name` lower-cased with every run of other characters as one dash: `Web App` → `web-app`. */
export function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "suite"
  )
}

/**
 * The run's suite: its own name, else its config folder's when git tracks several danwo configs
 * in the workspace, else none. `configs` lists them (git, by default).
 */
export function suiteIdentity(
  run: Pick<RunContext, "root" | "suite">,
  workspace: string,
  options: { readonly artifact?: string; readonly configs?: (workspace: string) => string[] } = {},
): SuiteIdentity {
  const several = () => (options.configs ?? trackedConfigs)(workspace).length > 1
  const name = run.suite ?? (several() ? folderSuiteName(run.root, workspace) : undefined)
  const slug = name === undefined ? undefined : slugOf(name)

  return {
    name,
    slug,
    artifact:
      options.artifact ?? (slug === undefined ? DEFAULT_ARTIFACT : `${DEFAULT_ARTIFACT}-${slug}`),
  }
}

/** The check run's name: `danwo`, or `danwo · dashboard` for a named suite. */
export function checkName(kind: RunKind, suite: SuiteIdentity): string {
  return suite.name === undefined ? CHECK_NAMES[kind] : `${CHECK_NAMES[kind]} · ${suite.name}`
}
