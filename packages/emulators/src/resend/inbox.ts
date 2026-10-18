import type { Emulator } from "../define.ts"
import type { Email } from "./entities.ts"
import { resendStore } from "./store.ts"

/** One email the emulator accepted, as a test reads it. */
export interface InboxEmail {
  readonly id: string
  readonly from: string
  readonly to: readonly string[]
  readonly subject: string
  readonly text: string | null
  readonly html: string | null
  readonly createdAt: string
  /** The first standalone run of exactly `digits` digits in the body, e.g. a sign-in code. */
  code(digits?: number): string | undefined
  /** Every http(s) link in the body, HTML links first, each once. */
  links(): string[]
}

/** What `resendInbox(emulator)` reads: the mail the app sent through Resend. */
export interface ResendInbox {
  /** Accepted emails, newest first; only those addressed to `to` (to, cc or bcc) when given. */
  list(to?: string): InboxEmail[]
  /** The newest email to `to`, if any. */
  latest(to: string): InboxEmail | undefined
  /** Waits up to `timeoutMs` (10 s by default) for an email to `to` accepted after `since`. */
  waitFor(to: string, options?: { since?: string; timeoutMs?: number }): Promise<InboxEmail>
}

const TAGS = /<(script|style)\b[\s\S]*?<\/\1>|<[^>]*>/gi

/** The readable text of an HTML body. */
function visibleText(html: string): string {
  return html.replace(TAGS, " ").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&")
}

function linksIn(email: Email): string[] {
  const fromHtml = [...(email.html ?? "").matchAll(/href\s*=\s*["'](https?:[^"']+)["']/gi)].map(
    (match) => (match[1] ?? "").replaceAll("&amp;", "&"),
  )
  const fromText = (email.text ?? "").match(/https?:\/\/[^\s<>"')]+/g) ?? []

  return [...new Set([...fromHtml, ...fromText])].filter((link) => link !== "")
}

function asInboxEmail(email: Email): InboxEmail {
  const body = `${email.text ?? ""}\n${visibleText(email.html ?? "")}`

  return {
    id: email.id,
    from: email.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    createdAt: email.created_at,
    code: (digits = 6) => body.match(new RegExp(`(?<!\\d)\\d{${digits}}(?!\\d)`))?.[0],
    links: () => linksIn(email),
  }
}

/** Whether `email` went to `address`, compared without case and ignoring display names. */
function sentTo(email: Email, address: string): boolean {
  const wanted = address.trim().toLowerCase()
  const recipients = [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])]

  return recipients.some((recipient) => recipient.toLowerCase().includes(wanted))
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What the Resend emulator accepted, read the way a test reads a mailbox. */
export function resendInbox(emulator: Pick<Emulator, "store">): ResendInbox {
  const list = (to?: string) =>
    resendStore(emulator.store)
      .emails.all()
      .filter((email) => to === undefined || sentTo(email, to))
      .toReversed()
      .map(asInboxEmail)

  const waitFor: ResendInbox["waitFor"] = async (to, options = {}) => {
    const timeout = options.timeoutMs ?? 10_000
    const giveUpAt = Date.now() + timeout
    const isNew = (email: InboxEmail) =>
      options.since === undefined || email.createdAt > options.since

    while (Date.now() <= giveUpAt) {
      const found = list(to).find(isNew)

      if (found) return found
      await pause(50)
    }

    throw new Error(`no email to ${to} arrived within ${timeout} ms`)
  }

  return { list, latest: (to) => list(to)[0], waitFor }
}
