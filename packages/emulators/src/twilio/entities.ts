import type { MessageInstance } from "twilio/lib/rest/api/v2010/account/message.js"
import type { ServiceInstance } from "twilio/lib/rest/verify/v2/service.js"
import type { VerificationInstance } from "twilio/lib/rest/verify/v2/service/verification.js"
import type { VerificationCheckInstance } from "twilio/lib/rest/verify/v2/service/verificationCheck.js"

/** The JSON a resource arrives as: what the SDK's constructor parses into the instance. */
type Payload<Instance> = Instance extends abstract new (
  version: never,
  payload: infer P,
  ...rest: never[]
) => unknown
  ? P
  : never

/** A payload on the wire: dates travel as strings. */
type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] }

/** Fields Twilio sends as `null` until they apply, which the SDK types as always present. */
type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null }

/** A message as the Messages API answers it. */
export type Message = Nullable<
  Wire<Payload<typeof MessageInstance>>,
  "error_code" | "error_message" | "messaging_service_sid" | "date_sent" | "price"
>
/** A Verify service. */
export type VerifyService = Wire<Payload<typeof ServiceInstance>>
/** A verification, as created and fetched. */
export type Verification = Wire<Payload<typeof VerificationInstance>>
/** The answer to a verification check. */
export type VerificationCheck = Wire<Payload<typeof VerificationCheckInstance>>

export type MessageStatus = Message["status"]

/** What the emulator remembers about a message beyond what the API shows. */
export interface MessageExtra {
  /** Where status changes are POSTed, when the send asked for it. */
  readonly statusCallback: string | null
  /** The error a send to an unreachable number ends with, as Twilio's delivery error code. */
  readonly failsWith: number | null
  /** Sent by Verify on the account's behalf: on the phone, but not in the account's message list. */
  readonly viaVerify: boolean
}

/** What the emulator remembers about a verification: its code and how it has been checked. */
export interface VerificationExtra {
  readonly code: string
  readonly checks: number
  /** When the code stops working, in epoch milliseconds. */
  readonly expiresAt: number
}

/** An account the API answers for, with its auth token. */
export interface Account {
  readonly id: string
  readonly authToken: string
  readonly friendlyName: string
}

/** An API key: another way to authenticate as an account. */
export interface ApiKey {
  readonly id: string
  readonly secret: string
  readonly accountSid: string
}

/** A number the account owns, and where messages sent to it are POSTed. */
export interface PhoneNumber {
  /** The number in E.164. */
  readonly id: string
  readonly accountSid: string
  readonly smsUrl: string | null
}

/** A number the emulator cannot deliver to, and the error a message to it fails with. */
export interface Unreachable {
  readonly id: string
  readonly errorCode: number
}
