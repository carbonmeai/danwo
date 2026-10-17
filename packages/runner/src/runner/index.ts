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
  SessionDefinition,
  SessionExtras,
  SessionFixtures,
  SessionSetup,
  SuiteFixtures,
  TestAPI,
  TestCase,
  TestFixtures,
  TestOptions,
  UseOptions,
} from "../tests/types.ts"
export { catalogOf, type CatalogEntry, testFilesOf } from "./catalog.ts"
export {
  type DanwoConfig,
  defineConfig,
  type LoadedConfig,
  loadConfig,
  nearestConfig,
} from "./config.ts"
export { defaultOutboundFaults } from "./faults.ts"
export type { EnvironmentContext, WorkerEnvironment } from "./environment.ts"
export {
  environmentState,
  type FlightRecord,
  type RecordedStep,
  type RecordMode,
  runsDir,
} from "./record.ts"
export { findRun } from "./report.ts"
export { failurePage } from "./failure-page.ts"
export { runMatrix, type RunMatrixOptions } from "./matrix-command.ts"
export type { MatrixRunReport, Reporter, RunContext, RunKind, TestRunReport } from "./reporting.ts"
export type { AttemptReport, TestReport } from "./tasks.ts"
export { redactCredentials } from "../secrets/credentials.ts"
export { createRedactor, type Redactor } from "./redact.ts"
export { runTests, type RunTestsOptions } from "./test-command.ts"
export { showRun, type ShowRunOptions } from "./show.ts"
export { type CacheAction, type CacheCommandOptions, runCache } from "./cache-command.ts"
export { exitCodeForError } from "../support/codes.ts"
export type { RelocationPolicy } from "../replay/policy.ts"
export type { Budget, Budgets } from "../agent/budget.ts"
export type { ErrorClass, ErrorCode } from "../support/codes.ts"
export {
  type AwsEnvironment,
  awsEnvironment,
  type AwsFixture,
  type AwsOptions,
  awsService,
  MINISTACK_IMAGE,
} from "./aws.ts"
export {
  type GithubEnvironment,
  githubEnvironment,
  type GithubOptions,
  githubService,
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
  type SlackEnvironment,
  slackEnvironment,
  type SlackOptions,
  slackService,
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
