/*
 * danwo for Playwright Test suites: the project's environment (app, emulators, proxy) per worker,
 * a `danwo` fixture with the emulators and live faults, invariants, and flight records attached to
 * failed tests. `danwo-playwright matrix` runs a spec once clean and once per planned fault.
 */
export type { EnvironmentFactory, WorkerSetup } from "./environment.ts"
export {
  type Danwo,
  type DanwoHandle,
  type DanwoTest,
  type DanwoTestFixtures,
  type DanwoWorkerFixtures,
  expect,
  type Invariant,
  type InvariantArgs,
  test,
  testWith,
} from "./fixture.ts"
export { judgeTrial, type PlaywrightMatrixOptions, runPlaywrightMatrix } from "./matrix.ts"
