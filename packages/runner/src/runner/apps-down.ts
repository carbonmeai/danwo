/**
 * Apps of the environment that went down during a test. A test that fails after the API it calls
 * crashed otherwise shows only symptoms (a refused connection, a page that never loads), so its
 * error and its record name the app that stopped.
 */
import type { TestError } from "../support/errors.ts"
import type { WorkerEnvironment } from "./environment.ts"

/** The apps that have stopped so far: what a test's start is compared with. */
export function appsDownNow(env: WorkerEnvironment | undefined): readonly string[] {
  return env?.stopped?.() ?? []
}

/** The apps that stopped between `before` and now, e.g. `["api exited with code 1"]`. */
export function appsDownSince(
  env: WorkerEnvironment | undefined,
  before: readonly string[],
): string[] {
  return appsDownNow(env).filter((stopped) => !before.includes(stopped))
}

/** The note a record keeps for each app that went down during the test. */
export function appsDownNotes(down: readonly string[]): string[] {
  return down.map((stopped) => `${stopped} during this test; its last output is in this record`)
}

/** The test's error with the apps that went down added, so the failure names its likely cause. */
export function withAppsDown(
  error: TestError | undefined,
  down: readonly string[],
): TestError | undefined {
  if (error === undefined || down.length === 0) return error

  return { ...error, message: `${error.message}\n(${down.join("; ")} during this test)` }
}
