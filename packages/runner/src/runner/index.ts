/*
 * The danwo test runner: config, the public test API, worker-scoped environments, and the
 * `danwo test` / `danwo matrix` entry points.
 */
export {
  type Expect,
  expect,
  type LocatorAssertions,
  type PageAssertions,
  type VisualOptions,
} from "../assert/index.ts"
export type { App } from "../browser/index.ts"
export type { ActOptions, ActResult, Agent, ExtractOptions } from "../agent/index.ts"
export { z } from "zod"
export { unique } from "../replay/index.ts"
export type { Secret } from "../secrets/index.ts"
export type { Locator, Screen } from "../locate/index.ts"
export { test } from "../tests/api.ts"
export type {
  FixtureDefinitions,
  FixtureSetup,
  SuiteFixtures,
  TestAPI,
  TestCase,
  TestFixtures,
  TestOptions,
} from "../tests/types.ts"
export { type DanwoConfig, defineConfig, loadConfig } from "./config.ts"
export { defaultOutboundFaults } from "./faults.ts"
export type { EnvironmentContext, WorkerEnvironment } from "./environment.ts"
export type { FlightRecord, RecordMode } from "./record.ts"
export { runMatrix, type RunMatrixOptions } from "./matrix-command.ts"
export { runTests, type RunTestsOptions } from "./test-command.ts"
export { showRun, type ShowRunOptions } from "./show.ts"
export {
  type AwsEnvironment,
  awsEnvironment,
  type AwsFixture,
  type AwsOptions,
  awsService,
  MINISTACK_IMAGE,
} from "./aws.ts"
export {
  type GoogleEnvironment,
  googleEnvironment,
  type GoogleOptions,
  googleService,
  type MicrosoftEnvironment,
  microsoftEnvironment,
  type MicrosoftOptions,
  microsoftService,
  type OAuthEnvironment,
  type OAuthService,
  type Seed,
} from "./oauth.ts"
export {
  type S3Environment,
  s3Environment,
  type S3Options,
  s3Service,
  type S3Service,
} from "./s3.ts"
export { type Service, type Services, startServices } from "./services.ts"
export {
  type StripeEnvironment,
  stripeEnvironment,
  type StripeOptions,
  stripeService,
  type StripeService,
} from "./stripe.ts"
