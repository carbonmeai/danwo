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
export type {
  ActOptions,
  ActResult,
  Agent,
  AssertOptions,
  ExtractOptions,
  PollOption,
  WaitForOptions,
} from "../agent/index.ts"
export type { ReadinessMode } from "../browser/readiness.ts"
export {
  gmailMail,
  latestMail,
  type MailMessage,
  type MailSource,
  outlookMail,
  pickFrom,
  resendMail,
  twilioSms,
} from "../mail/index.ts"
export { backendOf } from "./backend.ts"
export type { SessionMail } from "../session.ts"
export { totp } from "../secrets/totp.ts"
export { z } from "zod"
export { unique } from "../replay/index.ts"
export type { Secret } from "../secrets/index.ts"
export type { FieldKind, SecretPurpose, SessionSecret } from "../secrets/vault.ts"
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
export { DEFAULT_WEBHOOK_FAULTS, defaultOutboundFaults } from "./faults.ts"
export { FAULT_FORMS, FaultBench, type NamedFault, parseFault } from "./fault-bench.ts"
export type { EnvironmentContext, WorkerEnvironment } from "./environment.ts"
export {
  environmentState,
  type FlightRecord,
  type RecordedExchange,
  type RecordedStep,
  type RecordMode,
  redactExchange,
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
export { mergeReports, type MergeReportsOptions } from "./merge-command.ts"
export { explainImpact, type ImpactCommandOptions } from "./impact-command.ts"
export type { ImpactConfig, ImpactEntry, ImpactIndex } from "./impact.ts"
export { junit, type JunitOptions } from "./junit.ts"
export { inCi } from "./ci.ts"
export { showRun, type ShowRunOptions } from "./show.ts"
export { lintRun, type LintRunOptions } from "./lint-command.ts"
export {
  distinctFindings,
  type LintConfig,
  type LintEvidence,
  type LintFinding,
  type LintRule,
  LINT_RULES,
  type LintSeverity,
  type RuleLevel,
} from "../lint/index.ts"
export type { TrialFindings } from "./reporting.ts"
export { type CacheAction, type CacheCommandOptions, runCache } from "./cache-command.ts"
export { type ErrorCodeRow, errorCodeTable, exitCodeForError } from "../support/codes.ts"
export { CACHE_OUTCOMES, type CacheOutcome } from "../record/steps.ts"
export type { RelocationPolicy } from "../replay/policy.ts"
export type { VisionChoice, VisionMode, VisionSetting } from "../vision/desk.ts"
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
  type FlutterwaveEnvironment,
  flutterwaveEnvironment,
  type FlutterwaveOptions,
  flutterwaveService,
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
  type PaystackEnvironment,
  paystackEnvironment,
  type PaystackOptions,
  paystackService,
  type Seed,
  type SlackEnvironment,
  slackEnvironment,
  type SlackOptions,
  slackService,
  type TwilioEnvironment,
  twilioEnvironment,
  type TwilioOptions,
  twilioService,
  type BachsEnvironment,
  bachsEnvironment,
  type BachsOptions,
  bachsService,
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
