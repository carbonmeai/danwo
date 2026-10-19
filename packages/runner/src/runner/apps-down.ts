/**
 * Apps of the environment that are down. A test that fails after the API it calls crashed (during
 * the test, or between tests while the environment reset) otherwise shows only symptoms (a
 * refused connection, a page that never loads), so its error and its record name the app.
 */
import type { TestError } from "../support/errors.ts"
import type { WorkerEnvironment } from "./environment.ts"

/** The apps that have stopped on their own so far, e.g. `["api exited with code 1"]`. */
export function appsDownNow(env: WorkerEnvironment | undefined): readonly string[] {
  return env?.stopped?.() ?? []
}

/** The note a record keeps for each app that is down. */
export function appsDownNotes(down: readonly string[]): string[] {
  return down.map(
    (stopped) => `${stopped}: its last output is in this record or in the run's environment-*.json`,
  )
}

/** The test's error with the apps that are down added, so the failure names its likely cause. */
export function withAppsDown(
  error: TestError | undefined,
  down: readonly string[],
): TestError | undefined {
  if (error === undefined || down.length === 0) return error

  return { ...error, message: `${error.message}\n(${down.join("; ")})` }
}
