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

/** Fixtures a `resendEnvironment()` or `resendService()` contributes. */
export interface ResendFixtures {
  /** The Resend emulator; read the mail the app sent with `resendInbox(resend)`. */
  readonly resend: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures an `awsEnvironment()` or `awsService()` (MiniStack) contributes. */
export interface AwsFixtures {
  readonly aws: AwsFixture
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures an `auth0Environment()` or `auth0Service()` contributes. */
export interface Auth0Fixtures {
  /**
   * The Auth0 emulator: read users, logins, live refresh tokens and verification emails with
   * `auth0Tenant(auth0)`, block a user with `auth0Tenant(auth0).block(email)`, and compute an
   * MFA code with `auth0OtpAt(secret, time)`.
   */
  readonly auth0: Emulator
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

/** Fixtures a `flutterwaveEnvironment()` or `flutterwaveService()` contributes. */
export interface FlutterwaveFixtures {
  /**
   * The Flutterwave emulator: read its books with `flutterwaveLedger(flutterwave)` and pay a virtual
   * account with `flutterwaveBank(flutterwave).transferIn(...)`.
   */
  readonly flutterwave: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `bachsEnvironment()` or `bachsService()` contributes. */
export interface BachsFixtures {
  /** The Bachs emulator: read payments, subscriptions, refunds and payouts with `bachsLedger(bachs)`. */
  readonly bachs: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `nylasEnvironment()` or `nylasService()` contributes. */
export interface NylasFixtures {
  /** The Nylas emulator: read grants, mail and events and deliver mail with `nylasApplication(nylas)`. */
  readonly nylas: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `nangoEnvironment()` or `nangoService()` contributes. */
export interface NangoFixtures {
  /** The Nango emulator: read connections and proxied calls, and revoke one, with `nangoProject(nango)`. */
  readonly nango: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `unipileEnvironment()` or `unipileService()` contributes. */
export interface UnipileFixtures {
  /** The Unipile emulator: read accounts and messages and message the app's users with `unipileWorkspace(unipile)`. */
  readonly unipile: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `composioEnvironment()` or `composioService()` contributes. */
export interface ComposioFixtures {
  /**
   * The Composio emulator: read connected accounts and tool runs and fire triggers with
   * `composioProject(composio)`, and answer tools from the test with `composioTools(composio)`.
   */
  readonly composio: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures a `clerkEnvironment()` or `clerkService()` contributes. */
export interface ClerkFixtures {
  /**
   * The Clerk emulator: read the instance's keys, users, sessions and emailed codes, and revoke a
   * user's sessions mid-test, with `clerkInstance(clerk)`.
   */
  readonly clerk: Emulator
  readonly proxy: Proxy
  readonly settle: () => Promise<void>
}

/** Fixtures an `llmEnvironment()` or `llmService()` contributes. */
export interface LlmFixtures {
  /**
   * The model API emulator: read the app's model calls with `llmCalls(llm)` and script more replies
   * with `llmScripts(llm).add(...)`.
   */
  readonly llm: Emulator
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

/** Fixtures a `paystackEnvironment()` or `paystackService()` contributes. */
export interface PaystackFixtures {
  /**
   * The Paystack emulator: read what was paid with `paystackLedger(paystack)` and send money to a
   * dedicated account with `paystackBank(paystack).transferTo(number, amount)`.
   */
  readonly paystack: Emulator
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
  type AppCommand,
  appEnvironment,
  type AppEnvironmentOptions,
  type ModelPrice,
  priced,
  type NangoEnvironment,
  nangoEnvironment,
  type NangoOptions,
  nangoService,
  type NylasEnvironment,
  nylasEnvironment,
  type NylasOptions,
  nylasService,
  type ResendEnvironment,
  resendEnvironment,
  type ResendOptions,
  resendService,
  type UnipileEnvironment,
  unipileEnvironment,
  type UnipileOptions,
  unipileService,
  type StartedApp,
  startApp,
  type StackApp,
  stackEnvironment,
  type StackEnvironmentOptions,
  type StackUrls,
  type UnroutedHosts,
  INNGEST_HOST,
  type InngestOptions,
  type InngestRun,
  type InngestService,
  inngestService,
  type Auth0Environment,
  auth0Environment,
  type Auth0Options,
  auth0Service,
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
  type FlutterwaveEnvironment,
  flutterwaveEnvironment,
  type FlutterwaveOptions,
  flutterwaveService,
  type GithubEnvironment,
  githubEnvironment,
  type GithubOptions,
  githubService,
  type ComposioEnvironment,
  composioEnvironment,
  type ComposioOptions,
  composioService,
  type GoogleEnvironment,
  googleEnvironment,
  type GoogleOptions,
  googleService,
  type LlmEnvironment,
  llmEnvironment,
  type LlmOptions,
  llmService,
  type MicrosoftEnvironment,
  microsoftEnvironment,
  type MicrosoftOptions,
  microsoftService,
  MINISTACK_IMAGE,
  type PaystackEnvironment,
  paystackEnvironment,
  type PaystackOptions,
  paystackService,
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
  type BachsEnvironment,
  bachsEnvironment,
  type BachsOptions,
  bachsService,
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
  SessionTime,
  Span,
  VisionChoice,
  VisionMode,
  VisionSetting,
  VisualOptions,
  WaitForOptions,
} from "@danwo/runner/runner"
/**
 * Where an environment's mail and texts land, for the `mail` fixture and the agent's mail tools; a
 * text is addressed by its phone number.
 */
export { gmailMail, outlookMail, resendMail, totp, twilioSms } from "@danwo/runner/runner"
/**
 * `spawn()` for a process an environment starts (an app, a server): it leads its own process
 * group and is stopped with what it started when the run stops it, ends, is interrupted or dies.
 */
export { type OwnedChild, spawnOwned } from "@danwo/runner/children"
/** zod, for the schemas `agent.extract` checks its result against. */
export { z } from "@danwo/runner/runner"
/** A JUnit XML reporter for CI systems other than GitHub, and the config's change-impact rules. */
export { type ImpactConfig, junit, type JunitOptions } from "@danwo/runner/runner"
export {
  type Auth0LoginView,
  auth0OtpAt,
  type Auth0SeedApi,
  type Auth0SeedClient,
  type Auth0SeedConfig,
  type Auth0SeedRole,
  type Auth0SeedTenant,
  type Auth0SeedUser,
  type Auth0Tenant,
  auth0Tenant,
  type Auth0UserView,
  type CalendarEntry,
  type CalendarSeedEvent,
  type Emulator,
  type DriveEntry,
  type DriveSeedFile,
  type FlutterwaveBank,
  flutterwaveBank,
  type FlutterwaveLedger,
  flutterwaveLedger,
  type FlutterwaveSeedConfig,
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
  type LlmCall,
  type LlmCalls,
  llmCalls,
  type LlmMatchInput,
  type LlmRecordOptions,
  type LlmReply,
  type LlmScript,
  type LlmScripts,
  llmScripts,
  type LlmSeedConfig,
  type LlmToolCall,
  type OneDrive,
  oneDrive,
  type OutlookCalendar,
  type OutlookMailbox,
  type OutlookMessage,
  outlookCalendar,
  outlookMailbox,
  type PaystackBank,
  paystackBank,
  type PaystackLedger,
  paystackLedger,
  type PaystackSeedConfig,
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
  type BachsDeposit,
  type BachsLedger,
  bachsLedger,
  type BachsSeedConfig,
  type ComposioAccountView,
  type ComposioExecution,
  type ComposioProject,
  composioProject,
  type ComposioSeedConfig,
  type ComposioToolHandler,
  type ComposioTools,
  composioTools,
  type NangoCall,
  type NangoConnection,
  type NangoProject,
  nangoProject,
  type NangoSeedConfig,
  type NylasApplication,
  nylasApplication,
  type NylasSeedConfig,
  type UnipileSeedConfig,
  type UnipileWorkspace,
  unipileWorkspace,
} from "@danwo/emulators"
export {
  type DatabaseSnapshot,
  postgresSnapshot,
  type PostgresRestoreStrategy,
  type PostgresSnapshotOptions,
  postgresWorkerDatabase,
  redisSnapshot,
  type RedisSnapshotOptions,
  sqliteSnapshot,
  type SqliteSnapshotOptions,
  sqliteWorkerFile,
  type WorkerDatabaseOptions,
} from "@danwo/data"
/**
 * Fault proxies in front of the app's own database and cache: the app connects through
 * `proxy.url(realUrl)`, the environment lists them under `data`, and `danwo matrix` faults the
 * statements and commands its tests send.
 */
export {
  type DataCall,
  type DataCallStart,
  type DataFault,
  type DataFaultRule,
  type DataProxy,
  defaultDataFaults,
  pgError,
  POSTGRES_ERRORS,
  type PostgresProxyOptions,
  REDIS_ERRORS,
  redisError,
  type RedisProxyOptions,
  startPostgresProxy,
  startRedisProxy,
} from "@danwo/infra"
/**
 * Clerk: a development instance's Backend API, its Frontend API serving ClerkJS and `<SignIn/>`,
 * and its Account Portal; `clerkMail` reads its emailed codes as a session's mail source.
 */
export {
  type ClerkEnvironment,
  clerkEnvironment,
  clerkMail,
  type ClerkOptions,
  clerkService,
} from "@danwo/runner/runner"
export {
  type ClerkInstance,
  clerkInstance,
  type ClerkInstanceView,
  type ClerkMessage,
  type ClerkSeedConfig,
  type ClerkSeedOrganization,
  type ClerkSeedTemplate,
  type ClerkSeedUser,
  type ClerkUser,
} from "@danwo/emulators"
