// Public test API (plain async/await): what a `*.danwo.ts` file and `danwo.config.ts` import.
import type { Emulator } from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"
import {
  type AwsFixture,
  type Expect,
  type Secret,
  test as baseTest,
  type TestAPI,
  type TestFixtures,
} from "@danwo/runner/runner"

/** Fixtures every danwo test gets: the browser session's `agent`, `screen` and `app`, plus `expect` and `secret` bound to it. */
export interface DanwoFixtures extends TestFixtures {
  readonly expect: Expect
  /** A handle for a configured secret, to fill by name without its value reaching the model. */
  readonly secret: (name: string) => Secret
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

/** `test` typed with danwo's fixtures; the same runtime function as the runner's. */
export const test: TestAPI<DanwoFixtures> =
  baseTest.extend<Omit<DanwoFixtures, keyof TestFixtures>>()

/*
 * The registry's functions never use `this`; it destructures them the same way.
 * oxlint-disable-next-line typescript/unbound-method
 */
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
  startServices,
  type StripeEnvironment,
  stripeEnvironment,
  type StripeOptions,
  stripeService,
  type TestAPI,
  type TestCase,
  type TestFixtures,
  unique,
  type WorkerEnvironment,
} from "@danwo/runner/runner"
export type {
  ActOptions,
  ActResult,
  Agent,
  App,
  ExtractOptions,
  LocatorAssertions,
  PageAssertions,
  Screen,
  VisualOptions,
} from "@danwo/runner/runner"
/** zod, for the schemas `agent.extract` checks its result against. */
export { z } from "@danwo/runner/runner"
export {
  type CalendarEntry,
  type CalendarSeedEvent,
  type DriveEntry,
  type DriveSeedFile,
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
  type SignIn,
  type SignIns,
  type StoredObject,
} from "@danwo/emulators"
