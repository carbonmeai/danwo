// Public test API (plain async/await): what a `*.danwo.ts` file and `danwo.config.ts` import.
import type { Emulator } from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"
import {
  type AwsFixture,
  type Expect,
  type Secret,
  type SessionMail,
  test as baseTest,
  type TestAPI,
  type TestFixtures,
} from "@danwo/runner/runner"

/**
 * Fixtures every danwo test gets: the browser session's `agent`, `screen` and `app`, plus
 * `expect`, `secret` and `mail` bound to it.
 */
export interface DanwoFixtures extends TestFixtures {
  readonly expect: Expect
  /** A handle for a configured secret, to fill by name without its value reaching the model. */
  readonly secret: (name: string) => Secret
  /** Mail the app sent, from the environment's `mail` sources: codes, links, and opening it. */
  readonly mail: SessionMail
}

/** Fixtures a `stripeEnvironment()` worker environment contributes; type them with `test.extend<StripeFixtures>()`. */
export interface StripeFixtures {
  readonly stripe: Emulator
  readonly proxy: Proxy
  /** Plays pending webhook deliveries and retries to the end. */
  readonly settle: () => Promise<void>
}

/** Fixtures an `s3Environment()` or `s3Service()` contributes. */
export interface S3Fixtures {
  /** The S3 emulator; read what the app stored with `s3Objects(s3)`. */
  readonly s3: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures an `awsEnvironment()` or `awsService()` (MiniStack) contributes. */
export interface AwsFixtures {
  readonly aws: AwsFixture
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `googleEnvironment()` or `googleService()` contributes. */
export interface GoogleFixtures {
  /**
   * The Google emulator: read who signed in with `googleSignIns(google)`, and mail, events and
   * files with `gmailMailbox`, `googleCalendar` and `googleDrive`.
   */
  readonly google: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `microsoftEnvironment()` or `microsoftService()` contributes. */
export interface MicrosoftFixtures {
  /**
   * The Microsoft emulator: read who signed in with `microsoftSignIns(microsoft)`, and mail,
   * events, files and subscriptions with `outlookMailbox`, `outlookCalendar`, `oneDrive` and
   * `graphSubscriptions`.
   */
  readonly microsoft: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `slackEnvironment()` or `slackService()` contributes. */
export interface SlackFixtures {
  /** The Slack emulator: post as users and read what the app sent with `slackWorkspace(slack)`. */
  readonly slack: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `githubEnvironment()` or `githubService()` contributes. */
export interface GithubFixtures {
  /**
   * The GitHub emulator: read issues, comments and check runs with `githubRepo(github, "o/r")`,
   * who signed in with `githubSignIns(github)`, and an app's key with `githubAppKey`.
   */
  readonly github: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `twilioEnvironment()` or `twilioService()` contributes. */
export interface TwilioFixtures {
  /**
   * The Twilio emulator: read the texts phones got with `twilioInbox(twilio)` and text the app's
   * numbers with `twilioPhone(twilio).send(from, to, body)`.
   */
  readonly twilio: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** `test` typed with danwo's fixtures; the same runtime function as the runner's. */
export const test: TestAPI<DanwoFixtures> =
  baseTest.extend<Omit<DanwoFixtures, keyof TestFixtures>>()

/**
 * `test.describe` and the hooks, for files that import them by name. The registry's functions
 * never use `this`, so they work taken off `test`.
 */
// oxlint-disable-next-line typescript/unbound-method
export const { describe, beforeEach, afterEach, beforeAll, afterAll } = test

export {
  type AwsEnvironment,
  awsEnvironment,
  type AwsFixture,
  type AwsOptions,
  awsService,
  type DanwoConfig,
  defaultOutboundFaults,
  defineConfig,
  type EnvironmentContext,
  expect,
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
  MINISTACK_IMAGE,
  type S3Environment,
  s3Environment,
  type S3Options,
  s3Service,
  type Seed,
  type Service,
  type Services,
  type SlackEnvironment,
  slackEnvironment,
  type SlackOptions,
  slackService,
  startServices,
  type StripeEnvironment,
  stripeEnvironment,
  type StripeOptions,
  stripeService,
  type TestAPI,
  type SessionDefinition,
  type SessionFixtures,
  type SessionSetup,
  type TestCase,
  type TestFixtures,
  type TestOptions,
  type TwilioEnvironment,
  twilioEnvironment,
  type TwilioOptions,
  twilioService,
  unique,
  type UseOptions,
  type WorkerEnvironment,
} from "@danwo/runner/runner"
export type {
  ActOptions,
  ActResult,
  Agent,
  App,
  AssertOptions,
  ExtractOptions,
  LocatorAssertions,
  MailMessage,
  MailSource,
  PageAssertions,
  PollOption,
  ReadinessMode,
  Screen,
  SessionMail,
  VisualOptions,
  WaitForOptions,
} from "@danwo/runner/runner"
/**
 * Where an environment's mail and texts land, for the `mail` fixture and the agent's mail tools; a
 * text is addressed by its phone number.
 */
export { gmailMail, outlookMail, resendMail, totp, twilioSms } from "@danwo/runner/runner"
/** zod, for the schemas `agent.extract` checks its result against. */
export { z } from "@danwo/runner/runner"
/** A JUnit XML reporter for CI systems other than GitHub, and the config's change-impact rules. */
export { type ImpactConfig, junit, type JunitOptions } from "@danwo/runner/runner"
export {
  type CalendarEntry,
  type CalendarSeedEvent,
  type Emulator,
  type DriveEntry,
  type DriveSeedFile,
  type GithubCheckRunView,
  type GithubCommentView,
  type GithubIssueView,
  type GithubRepoView,
  type GithubSeedConfig,
  githubAppKey,
  githubRepo,
  githubSignIns,
  type GmailMailbox,
  type GmailMessage,
  type GmailSeedMessage,
  gmailMailbox,
  type GoogleCalendar,
  type GoogleDrive,
  type GoogleSeedConfig,
  googleCalendar,
  googleDrive,
  googleSignIns,
  type GraphSubscriptionEntry,
  graphSubscriptions,
  type InboxEmail,
  type IncomingMail,
  installGithubApp,
  listeningPort,
  type MicrosoftSeedConfig,
  type MicrosoftSeedEvent,
  type MicrosoftSeedFile,
  type MicrosoftSeedMessage,
  microsoftSignIns,
  type OneDrive,
  oneDrive,
  type OutlookCalendar,
  type OutlookMailbox,
  type OutlookMessage,
  outlookCalendar,
  outlookMailbox,
  type PubSubSeedSubscription,
  revokeGoogleAccess,
  revokeMicrosoftSessions,
  type ResendInbox,
  resendInbox,
  type S3Objects,
  s3Objects,
  type PhoneMessage,
  type SignIn,
  type SignIns,
  type SlackAction,
  type SlackEphemeral,
  type SlackMessage,
  type SlackSeedConfig,
  type SlackWorkspace,
  slackWorkspace,
  type StoredObject,
  type TwilioInbox,
  twilioInbox,
  type TwilioPhone,
  twilioPhone,
  type TwilioSeedConfig,
  uninstallGithubApp,
} from "@danwo/emulators"
