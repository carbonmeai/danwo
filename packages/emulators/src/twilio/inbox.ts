import type { Emulator } from "../define.ts"
import { waitUntil } from "../poll.ts"
import type { Message } from "./entities.ts"
import { receiveMessage } from "./events.ts"
import { twilioStore } from "./store.ts"

/** One text message a phone received, as a test reads it. */
export interface PhoneMessage {
  readonly sid: string
  readonly from: string
  readonly to: string
  readonly body: string
  readonly status: Message["status"]
  readonly createdAt: string
  /** The first standalone run of exactly `digits` digits (4 to 8 when not given), e.g. a sign-in code. */
  code(digits?: number): string | undefined
  /** Every http(s) link in the text, each once. */
  links(): string[]
}

/** What `twilioInbox(emulator)` reads: the texts sent to phones, by the app or by Verify. */
export interface TwilioInbox {
  /** Texts to `to` (every phone when not given), newest first. */
  list(to?: string): PhoneMessage[]
  /** The newest text to `to`, if any. */
  latest(to: string): PhoneMessage | undefined
  /** Waits up to `timeoutMs` (10 s by default) for a text to `to` sent after `since`. */
  waitFor(to: string, options?: { since?: string; timeoutMs?: number }): Promise<PhoneMessage>
}

function asPhoneMessage(message: Message): PhoneMessage {
  return {
    sid: message.sid,
    from: message.from,
    to: message.to,
    body: message.body,
    status: message.status,
    createdAt: message.date_created,
    code: (digits) => {
      const run = digits === undefined ? "\\d{4,8}" : `\\d{${digits}}`

      return new RegExp(`(?<!\\d)${run}(?!\\d)`).exec(message.body)?.[0]
    },
    links: () => [...new Set(message.body.match(/https?:\/\/[^\s<>"')]+/g) ?? [])],
  }
}

/** The texts the Twilio emulator sent to phones, read the way a test reads a phone. */
export function twilioInbox(emulator: Pick<Emulator, "store">): TwilioInbox {
  const list = (to?: string) =>
    twilioStore(emulator.store)
      .messages.all()
      .filter((message) => message.direction !== "inbound")
      .filter((message) => to === undefined || message.to === to)
      .toReversed()
      .map(asPhoneMessage)

  const waitFor: TwilioInbox["waitFor"] = (to, options = {}) => {
    const timeout = options.timeoutMs ?? 10_000
    const after = options.since === undefined ? -Infinity : Date.parse(options.since)

    return waitUntil(
      () => list(to).find((message) => Date.parse(message.createdAt) > after),
      timeout,
      `no text to ${to} arrived within ${timeout} ms`,
    )
  }

  return { list, latest: (to) => list(to)[0], waitFor }
}

/** A person's phone in a test: texts it sends reach the app through the number's SMS URL. */
export interface TwilioPhone {
  /** Texts `body` from `from` to the account's number `to`; returns the message sid. */
  send(from: string, to: string, body: string): string
}

/** A phone texting the app's Twilio numbers, as a person would. */
export function twilioPhone(emulator: Pick<Emulator, "store" | "outbox">): TwilioPhone {
  return {
    send(from, to, body) {
      const twilio = twilioStore(emulator.store)
      const number = twilio.numbers.get(to)
      const account = number && twilio.accounts.get(number.accountSid)

      if (account === undefined) throw new Error(`${to} is not one of the emulator's numbers`)

      const context = { twilio, outbox: emulator.outbox, clock: emulator.store.clock }

      return receiveMessage(context, account, { from, to, body }).sid
    },
  }
}
