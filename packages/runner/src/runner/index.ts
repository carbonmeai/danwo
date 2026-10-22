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
export type {
  DeviceBox,
  DeviceForeground,
  DeviceLogLine,
  DeviceNode,
  DevicePlatform,
  DevicePoint,
  DeviceScreenReading,
  DeviceStart,
  DeviceSwipe,
  DeviceTarget,
  LongPressOptions,
  ScreenFilm,
  ScrollDirection,
} from "../device/types.ts"
export {
  type Chain as DeviceChain,
  type ChainLink as DeviceChainLink,
  resolveChain,
} from "../device/match.ts"
export type { MissingArtifact, MissingCause } from "../record/missing.ts"
export type { CapturedVideo, RecordedVideo, VideoMark, VideoMode } from "../record/video.ts"
export {
  gmailMail,
  latestMail,
  type MailMessage,
  type MailSource,
  outlookMail,
  pickFrom,
  resendMail,
  twilioSms,
  clerkMail,
} from "../mail/index.ts"
export { backendOf } from "./backend.ts"
export type { SessionMail, UserSession } from "../session.ts"
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
  UserOptions,
  Users,
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
export { DEFAULT_KEEP_RUNS, findRun } from "./report.ts"
export { failurePage } from "./failure-page.ts"
export { runMatrix, type RunMatrixOptions } from "./matrix-command.ts"
export type { MatrixRunReport, Reporter, RunContext, RunKind, TestRunReport } from "./reporting.ts"
export type { AttemptReport, TestReport } from "./tasks.ts"
export { redactCredentials } from "../secrets/credentials.ts"
export { createRedactor, type Redactor } from "./redact.ts"
export { parseDuration, runTests, type RunTestsOptions } from "./test-command.ts"
export { mergeReports, type MergeReportsOptions } from "./merge-command.ts"
export { explainImpact, type ImpactCommandOptions } from "./impact-command.ts"
export { type ImpactConfig, type ImpactEntry, type ImpactIndex, readImpactIndex } from "./impact.ts"
export {
  historyDir,
  type HistoryAttempt,
  type HistoryError,
  type HistoryLint,
  type HistoryTest,
  type HistoryTrial,
  type MatrixHistory,
  type RunHistory,
  type TestHistory,
} from "./history.ts"
export {
  type LiveCall,
  type LiveDelivery,
  liveDir,
  type LiveEvent,
  type LiveRunStarted,
  type LiveStep,
} from "./live.ts"
export type { Usage } from "../record/usage.ts"
export { effectNotes, effectsOf } from "../record/effect-notes.ts"
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
export { failureVerdict, trialVerdict, type VerdictEvidence } from "./verdict.ts"
export {
  type FailureVerdict,
  fixAdvice,
  type Verdict,
  type VerdictConfidence,
  VERDICT_LABELS,
  verdictCounts,
  verdictSummary,
} from "./verdict-words.ts"
export { type CacheAction, type CacheCommandOptions, runCache } from "./cache-command.ts"
export { type ErrorCodeRow, errorCodeTable, exitCodeForError } from "../support/codes.ts"
export { CACHE_OUTCOMES, type CacheOutcome, recordingText } from "../record/steps.ts"
export type { RelocationPolicy } from "../replay/policy.ts"
export type { VisionChoice, VisionMode, VisionSetting } from "../vision/desk.ts"
export type { BrowserConfig, ContextOptions } from "../browser/context-options.ts"
export type { SessionTime, Span } from "../time/index.ts"
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
  type Auth0Environment,
  auth0Environment,
  type Auth0Options,
  auth0Service,
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
  type ClerkEnvironment,
  clerkEnvironment,
  type ClerkOptions,
  clerkService,
} from "./clerk.ts"
export { type LlmEnvironment, llmEnvironment, type LlmOptions, llmService } from "./llm.ts"
export {
  type ComposioEnvironment,
  composioEnvironment,
  type ComposioOptions,
  composioService,
} from "./composio.ts"
export {
  type NovuEnvironment,
  novuEnvironment,
  type NovuOptions,
  novuService,
  type PusherEnvironment,
  pusherEnvironment,
  type PusherOptions,
  pusherService,
  type TiptapEnvironment,
  tiptapEnvironment,
  type TiptapOptions,
  tiptapService,
} from "./realtime.ts"
export {
  type S3Environment,
  s3Environment,
  type S3Options,
  s3Service,
  type S3Service,
} from "./s3.ts"
export { type Service, type Services, startServices, type UnroutedHosts } from "./services.ts"
export {
  type AppCommand,
  appEnvironment,
  type AppEnvironmentOptions,
  type StartedApp,
  startApp,
} from "./app-environment.ts"
export {
  INNGEST_HOST,
  type InngestOptions,
  type InngestRun,
  type InngestService,
  inngestService,
} from "./inngest.ts"
export {
  type StackApp,
  stackEnvironment,
  type StackEnvironmentOptions,
  type StackUrls,
} from "./stack-environment.ts"
export {
  type NangoEnvironment,
  nangoEnvironment,
  type NangoOptions,
  nangoService,
  type NylasEnvironment,
  nylasEnvironment,
  type NylasOptions,
  nylasService,
  type UnipileEnvironment,
  unipileEnvironment,
  type UnipileOptions,
  unipileService,
} from "./connectors.ts"
export {
  RESEND_HOSTS,
  type ResendEnvironment,
  resendEnvironment,
  type ResendOptions,
  resendService,
} from "./resend.ts"
export { type ModelPrice, priced } from "../model/priced.ts"
export {
  type StripeEnvironment,
  stripeEnvironment,
  type StripeOptions,
  stripeService,
  type StripeService,
} from "./stripe.ts"
