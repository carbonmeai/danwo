// Provider emulators: defineEmulator, state, webhooks, OAuth, providers.
export {
  createEmulator,
  defineEmulator,
  type Emulator,
  type EmulatorContext,
  type EmulatorDefinition,
  type EmulatorOptions,
  type WebhookSetup,
} from "./define.ts"
export {
  GOOGLE_ENDPOINTS,
  GOOGLE_HOSTS,
  GOOGLE_ISSUER,
  type GoogleSeedConfig,
  google,
  googleOutboundFaults,
  googleSignIns,
  seedGoogle,
  type SignIn,
  type SignIns,
} from "./google/index.ts"
export {
  CONSUMER_TENANT_ID,
  MICROSOFT_HOSTS,
  type MicrosoftSeedConfig,
  microsoft,
  microsoftOutboundFaults,
  microsoftSignIns,
  seedMicrosoft,
} from "./microsoft/index.ts"
export { Outbox, type OutboxMessage } from "./outbox.ts"
export {
  type Clock,
  Collection,
  type Entity,
  Store,
  type StoreSnapshot,
  type NewRecord,
  systemClock,
} from "./store.ts"
export {
  type InboxEmail,
  resend,
  type ResendInbox,
  type ResendSeedConfig,
  resendInbox,
  resendOutboundFaults,
  seedResend,
} from "./resend/index.ts"
export {
  type S3Objects,
  type S3SeedConfig,
  type StoredObject,
  isS3Host,
  s3,
  s3Hosts,
  s3Objects,
  s3OutboundFaults,
  seedS3,
  TIGRIS_ENDPOINTS,
} from "./s3/index.ts"
export { seedStripe, stripe, stripeOutboundFaults, type StripeSeedConfig } from "./stripe/index.ts"
export { ManualClock, systemTimer, type Timer } from "./time.ts"
export {
  type DeliveryAttempt,
  type DeliveryPolicy,
  WebhookDispatcher,
  type WebhookEndpoint,
  type WebhookFault,
  type WebhookFaultRule,
  type WebhookSigner,
  describeWebhookFault,
} from "./webhooks.ts"
