import type {
  Message,
  MessageStatus,
  Verification,
  VerificationCheck,
  VerificationExtra,
  VerifyService,
} from "./entities.ts"
import { API_VERSION, iso, rfc2822, VERIFY_BASE } from "./helpers.ts"

/** A message as the API first answers a send, before any status change. */
export function messageObject(fields: {
  readonly sid: string
  readonly accountSid: string
  readonly from: string
  readonly to: string
  readonly body: string
  readonly media: readonly string[]
  readonly messagingServiceSid: string | null
  readonly direction: Message["direction"]
  readonly status: MessageStatus
  readonly now: Date
  /** Sent by a trial account. */
  readonly trial?: boolean
}): Message {
  const uri = `/${API_VERSION}/Accounts/${fields.accountSid}/Messages/${fields.sid}.json`
  const created = rfc2822(fields.now)

  return {
    sid: fields.sid,
    account_sid: fields.accountSid,
    api_version: API_VERSION,
    body: fields.body,
    direction: fields.direction,
    from: fields.from,
    to: fields.to,
    messaging_service_sid: fields.messagingServiceSid,
    status: fields.status,
    num_segments: String(Math.max(1, Math.ceil(fields.body.length / 160))),
    num_media: String(fields.media.length),
    price: null,
    /* A trial account's messages carry no price unit. */
    price_unit: fields.trial === true ? null : "USD",
    error_code: null,
    error_message: null,
    date_created: created,
    date_updated: created,
    date_sent: fields.direction === "inbound" ? created : null,
    uri,
    subresource_uris: {
      media: uri.replace(/\.json$/, "/Media.json"),
      feedback: uri.replace(/\.json$/, "/Feedback.json"),
    },
  } satisfies Message
}

/** A Verify service, with Twilio's defaults for what it was not given. */
export function serviceObject(fields: {
  readonly sid: string
  readonly accountSid: string
  readonly friendlyName: string
  readonly codeLength: number
  readonly now: Date
}): VerifyService {
  const url = `${VERIFY_BASE}/v2/Services/${fields.sid}`

  return {
    sid: fields.sid,
    account_sid: fields.accountSid,
    friendly_name: fields.friendlyName,
    code_length: fields.codeLength,
    lookup_enabled: false,
    psd2_enabled: false,
    skip_sms_to_landlines: false,
    dtmf_input_required: true,
    tts_name: "",
    do_not_share_warning_enabled: false,
    custom_code_enabled: false,
    push: { include_date: true, apn_credential_sid: null, fcm_credential_sid: null },
    totp: { issuer: fields.friendlyName, time_step: 30, code_length: 6, skew: 1 },
    default_template_sid: "",
    whatsapp: { msg_service_sid: null, from: null },
    passkeys: null,
    verify_event_subscription_enabled: false,
    date_created: iso(fields.now),
    date_updated: iso(fields.now),
    url,
    links: {
      verifications: `${url}/Verifications`,
      verification_checks: `${url}/VerificationCheck`,
      entities: `${url}/Entities`,
      messaging_configurations: `${url}/MessagingConfigurations`,
      rate_limits: `${url}/RateLimits`,
      webhooks: `${url}/Webhooks`,
      access_tokens: `${url}/AccessTokens`,
    },
  } satisfies VerifyService
}

/** A verification as created: pending, with the one attempt that sent its code. */
export function verificationObject(fields: {
  readonly sid: string
  readonly service: VerifyService
  readonly to: string
  readonly channel: Verification["channel"]
  readonly now: Date
}): Verification {
  const at = iso(fields.now)

  return {
    sid: fields.sid,
    service_sid: fields.service.sid,
    account_sid: fields.service.account_sid,
    to: fields.to,
    channel: fields.channel,
    status: "pending",
    valid: false,
    lookup: { carrier: null },
    amount: "",
    payee: "",
    send_code_attempts: [
      { attempt_sid: fields.sid.replace(/^VE/, "VL"), channel: fields.channel, time: at },
    ],
    date_created: at,
    date_updated: at,
    sna: null,
    url: `${fields.service.url}/Verifications/${fields.sid}`,
  } satisfies Verification
}

/** The answer to a check: the verification's state once the code was compared. */
export function checkObject(verification: Verification, now: Date): VerificationCheck {
  return {
    sid: verification.sid,
    service_sid: verification.service_sid,
    account_sid: verification.account_sid,
    to: verification.to,
    channel: verification.channel,
    status: verification.status,
    valid: verification.status === "approved",
    amount: "",
    payee: "",
    date_created: verification.date_created,
    date_updated: iso(now),
    sna_attempts_error_codes: [],
  } satisfies VerificationCheck
}

/** Whether a pending verification's code still works at `now`. */
export function isLive(extra: VerificationExtra, now: Date): boolean {
  return now.getTime() < extra.expiresAt
}
