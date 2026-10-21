/**
 * Emails the worker sends through Resend. Each is sent with an idempotency key named after the job
 * that asked for it, and noted once sent, so a retried step never sends a second copy: Resend
 * answers a repeated key with the first email, and a noted key isn't sent at all.
 */
import { eq } from "drizzle-orm"
import { NonRetriableError } from "inngest"
import { Resend } from "resend"

import { query } from "../shared/db/client.ts"
import { emails } from "../shared/db/schema.ts"
import { withTimeout } from "../shared/retry.ts"
import { settings } from "./settings.ts"

const resend = new Resend(settings.RESEND_API_KEY)

/** Resend failures a later attempt can get past; a bad address or payload never will. */
const TRANSIENT = new Set([
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
  "concurrent_idempotent_requests",
])

/** One email: what kind it is (for the log), its key, and what it says. */
export interface Email {
  readonly kind: string
  readonly key: string
  readonly to: string
  readonly subject: string
  readonly lines: readonly string[]
  /** A button at the end, as a link. */
  readonly action?: { readonly label: string; readonly url: string }
}

function htmlOf(email: Email): string {
  const body = email.lines.map((line) => `<p>${line}</p>`).join("")
  const action = email.action
    ? `<p><a href="${email.action.url}" style="background:#111;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">${email.action.label}</a></p>`
    : ""

  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${body}${action}<p style="color:#777">Relay</p></div>`
}

function textOf(email: Email): string {
  return [...email.lines, ...(email.action ? [`${email.action.label}: ${email.action.url}`] : [])]
    .join("\n\n")
    .replace(/<[^>]+>/g, "")
}

/**
 * Sends `email` unless it went already. Throws for Inngest to retry the step on a failure that may
 * pass; a refusal that won't (a bad address) ends the job instead.
 */
export async function send(email: Email): Promise<"sent" | "already sent"> {
  const [sent] = await query("read sent email", (db) =>
    db.select().from(emails).where(eq(emails.key, email.key)),
  )

  if (sent) return "already sent"

  const { data, error } = await withTimeout(
    resend.emails.send(
      {
        from: settings.MAIL_FROM,
        to: email.to,
        subject: email.subject,
        html: htmlOf(email),
        text: textOf(email),
      },
      { idempotencyKey: email.key },
    ),
    8_000,
    "resend emails.send",
  )

  if (error && !TRANSIENT.has(error.name))
    throw new NonRetriableError(`resend refused ${email.kind}: ${error.message}`)
  if (error || !data) throw new Error(`resend ${email.kind}: ${error?.message ?? "no answer"}`)

  await query("note sent email", (db) =>
    db
      .insert(emails)
      .values({ key: email.key, kind: email.kind, to: email.to, resendId: data.id })
      .onConflictDoNothing(),
  )

  return "sent"
}
