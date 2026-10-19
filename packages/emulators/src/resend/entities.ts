import type {
  ApiKey,
  CreateApiKeyOptions,
  DomainRegion,
  GetDomainResponseSuccess,
  GetEmailResponseSuccess,
  GetWebhookResponseSuccess,
  WebhookEventPayload,
} from "resend"

/** The objects the Resend emulator keeps, in the resend SDK's own shapes. */
export type Email = GetEmailResponseSuccess
export type Domain = GetDomainResponseSuccess
export type Webhook = GetWebhookResponseSuccess
export type Key = ApiKey

/** What an API key may do: everything, or only send email. */
export type KeyPermission = NonNullable<CreateApiKeyOptions["permission"]>

/** An API key's secret token, shown only when it is created, and what the key may do. */
export interface KeyToken {
  readonly token: string
  readonly permission?: KeyPermission
}

export type Region = DomainRegion

export const REGIONS: readonly Region[] = ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"]

/** Event types a Resend webhook can subscribe to. */
export type EventType = WebhookEventPayload["type"]

/** The event types Resend documents for webhooks, checked against the SDK's own list. */
const EVENT_TYPES = [
  "email.sent",
  "email.scheduled",
  "email.delivered",
  "email.delivery_delayed",
  "email.complained",
  "email.bounced",
  "email.opened",
  "email.clicked",
  "email.received",
  "email.failed",
  "email.suppressed",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "domain.created",
  "domain.updated",
  "domain.deleted",
] as const satisfies readonly EventType[]

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value)
}
