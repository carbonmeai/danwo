/**
 * Mail the app sent, read where the emulators caught it: a sign-in code, a magic link, the whole
 * message to open in the browser. A step that types a code from an email records where the code
 * came from (the newest mail to that address) instead of the code itself, so a replay reads the
 * new code from the emulator and needs no model.
 */
import { type Emulator, gmailMailbox, outlookMailbox, resendInbox } from "@danwo/emulators"

/** One email as a test or the agent reads it. */
export interface MailMessage {
  readonly to: readonly string[]
  readonly subject: string
  readonly html: string | undefined
  readonly text: string | undefined
}

/** Somewhere mail lands: an emulator's outbox or mailbox. */
export interface MailSource {
  /** The newest email to `address`, if this source caught one. */
  latest(address: string): MailMessage | undefined
}

/** What is taken from an email: its code, or one of its links. */
export interface MailPick {
  readonly kind: "code" | "link"
  /** For a link: a word its URL or text contains, to tell several links apart. */
  readonly match?: string | undefined
  /** For a code: how many digits; default 4 to 8, the first such run. */
  readonly digits?: number | undefined
}

/** Mail the Resend emulator accepted from the app. */
export function resendMail(emulator: Pick<Emulator, "store">): MailSource {
  const inbox = resendInbox(emulator)

  return {
    latest(address) {
      const found = inbox.latest(address)

      return (
        found && {
          to: found.to,
          subject: found.subject,
          html: found.html ?? undefined,
          text: found.text ?? undefined,
        }
      )
    },
  }
}

/** Mail delivered to a Gmail mailbox of the Google emulator. */
export function gmailMail(emulator: Pick<Emulator, "store" | "outbox">): MailSource {
  return {
    latest(address) {
      const found = gmailMailbox(emulator, address).inbox()[0]

      return found && { to: [found.to], subject: found.subject, html: found.html, text: found.text }
    },
  }
}

/** Mail delivered to an Outlook mailbox of the Microsoft emulator. */
export function outlookMail(emulator: Pick<Emulator, "store" | "outbox">): MailSource {
  return {
    latest(address) {
      const found = outlookMailbox(emulator, address).latest("inbox")

      return found && { to: found.to, subject: found.subject, html: found.body, text: undefined }
    },
  }
}

/** The newest email to `address` among `sources`. */
export function latestMail(
  sources: readonly MailSource[],
  address: string,
): MailMessage | undefined {
  for (const source of sources) {
    const found = source.latest(address)

    if (found !== undefined) return found
  }

  return undefined
}

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}

/** An HTML body as the words a reader sees. */
function readable(html: string): string {
  return html
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
}

/** What a message says, as text: its text part and its HTML's words. */
function wordsOf(message: MailMessage): string {
  return `${message.subject}\n${message.text ?? ""}\n${readable(message.html ?? "")}`
}

/** Every link in a message, with the text it is shown as; HTML links first. */
function linksOf(message: MailMessage): readonly { url: string; label: string }[] {
  const anchors = [
    ...(message.html ?? "").matchAll(
      /<a\b[^>]*href=["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ].map((m) => ({ url: (m[1] ?? "").replaceAll("&amp;", "&"), label: readable(m[2] ?? "").trim() }))
  const bare = ((message.text ?? "").match(/https?:\/\/[^\s<>"')]+/g) ?? []).map((url) => ({
    url,
    label: "",
  }))

  return [...anchors, ...bare].filter(
    (link, at, all) => all.findIndex((other) => other.url === link.url) === at,
  )
}

/** The value `pick` takes from `message`, if it has one. */
export function pickFrom(message: MailMessage, pick: MailPick): string | undefined {
  if (pick.kind === "code") {
    const run = pick.digits === undefined ? "\\d{4,8}" : `\\d{${pick.digits}}`

    return new RegExp(`(?<![\\d\\w])${run}(?![\\d\\w])`).exec(wordsOf(message))?.[0]
  }

  const wanted = pick.match?.toLowerCase()

  return linksOf(message).find(
    (link) =>
      wanted === undefined ||
      link.url.toLowerCase().includes(wanted) ||
      link.label.toLowerCase().includes(wanted),
  )?.url
}

/** A message ready to show in a browser tab, with its subject on top. */
export function mailPage(message: MailMessage): string {
  const subject = message.subject.replace(/[<>&]/g, " ")
  const body = message.html ?? `<pre>${(message.text ?? "").replace(/[<>&]/g, " ")}</pre>`

  return `<!doctype html><title>${subject}</title><h1>${subject}</h1>${body}`
}
