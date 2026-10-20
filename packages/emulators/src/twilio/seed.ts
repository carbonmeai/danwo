import { createHash } from "node:crypto"

import type { Store } from "../store.ts"
import { serviceObject } from "./formatters.ts"
import { rfc2822 } from "./helpers.ts"
import { type TwilioStore, twilioStore } from "./store.ts"

/** An account the API answers for. */
export interface TwilioSeedAccount {
  /** `AC` and 32 hex digits. */
  readonly sid: string
  readonly authToken: string
  readonly friendlyName?: string
  /** `Full` by default; a `Trial` account only messages its `verified` numbers. */
  readonly type?: "Trial" | "Full"
  /** The recipients a trial account has verified. */
  readonly verified?: readonly string[]
}

/** An API key (`SK…`) with its secret, authenticating as an account (the first one by default). */
export interface TwilioSeedApiKey {
  readonly sid: string
  readonly secret: string
  readonly account?: string
}

/** A number the account owns; messages to it are POSTed to `smsUrl`. */
export interface TwilioSeedNumber {
  /** E.164, e.g. `+15005550006`. */
  readonly number: string
  readonly smsUrl?: string
  readonly account?: string
}

/** A Verify service; without a `sid`, one derived from its name, the same on every seed. */
export interface TwilioSeedService {
  readonly sid?: string
  readonly friendlyName: string
  readonly codeLength?: number
  readonly account?: string
}

/** A phone the emulator cannot reach: messages to it end undelivered with `errorCode` (30003 by default). */
export interface TwilioSeedUnreachable {
  readonly number: string
  readonly errorCode?: number
}

/** Data to load into a Twilio emulator. */
export type TwilioSeedConfig = Partial<{
  readonly accounts: readonly TwilioSeedAccount[]
  readonly apiKeys: readonly TwilioSeedApiKey[]
  readonly numbers: readonly TwilioSeedNumber[]
  readonly verifyServices: readonly TwilioSeedService[]
  readonly unreachable: readonly TwilioSeedUnreachable[]
}>

/** A sid of `prefix` derived from `seed`: the same every time, so names built on it stay put. */
function stableTwilioSid(prefix: string, seed: string): string {
  return prefix + createHash("sha256").update(`${prefix}:${seed}`).digest("hex").slice(0, 32)
}

/** What seeding one kind of data needs: the store, and who owns what names no account. */
interface Seeding {
  readonly twilio: TwilioStore
  readonly store: Store
  readonly owner: (given: string | undefined) => string
}

function seedService(seeding: Seeding, service: TwilioSeedService): void {
  seeding.twilio.services.add(
    serviceObject({
      sid: service.sid ?? stableTwilioSid("VA", service.friendlyName),
      accountSid: seeding.owner(service.account),
      friendlyName: service.friendlyName,
      codeLength: service.codeLength ?? 6,
      now: seeding.store.clock(),
    }),
    null,
  )
}

/** Each kind of seed data, loaded in order: accounts first, since the rest belong to one. */
const SEEDERS: readonly ((seeding: Seeding, config: TwilioSeedConfig) => void)[] = [
  ({ twilio, store }, { accounts = [] }) => {
    const createdAt = rfc2822(store.clock())

    for (const { sid, authToken, friendlyName = "danwo", type = "Full", verified = [] } of accounts)
      twilio.accounts.add({ id: sid, authToken, friendlyName, type, verified, createdAt }, null)
  },
  ({ twilio, owner }, { apiKeys = [] }) => {
    for (const { sid, secret, account } of apiKeys)
      twilio.keys.add({ id: sid, secret, accountSid: owner(account) }, null)
  },
  ({ twilio, owner }, { numbers = [] }) => {
    for (const { number, account, smsUrl = null } of numbers)
      twilio.numbers.add({ id: number, accountSid: owner(account), smsUrl }, null)
  },
  (seeding, { verifyServices = [] }) => {
    for (const service of verifyServices) seedService(seeding, service)
  },
  ({ twilio }, { unreachable = [] }) => {
    for (const { number, errorCode = 30003 } of unreachable)
      twilio.unreachable.add({ id: number, errorCode }, null)
  },
]

/** Loads `config` into a Twilio emulator's store. Seeded data sends nothing. */
export function seedTwilio(store: Store, config: TwilioSeedConfig): void {
  const first = config.accounts?.[0]?.sid ?? ""
  const seeding: Seeding = { twilio: twilioStore(store), store, owner: (given) => given ?? first }

  for (const seed of SEEDERS) seed(seeding, config)
}
