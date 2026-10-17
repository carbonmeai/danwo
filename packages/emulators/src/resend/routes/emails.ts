import type { CancelEmailResponseSuccess, CreateEmailResponseSuccess } from "resend"

import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import type { DataKey } from "../../store.ts"
import type { ResendRouteContext } from "../context.ts"
import type { Email } from "../entities.ts"
import { listedEmail } from "../formatters.ts"
import {
  addresses,
  jsonBody,
  listOf,
  newUuid,
  notFound,
  resendError,
  tagsOf,
  textOf,
} from "../helpers.ts"

const KEY_LIMIT = 256
const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000

/** A send the request asked for, before it is stored. */
type Draft = Omit<Email, "id" | "message_id" | "created_at" | "last_event" | "object">

/** What one idempotency key remembers: what was sent and what was answered. */
interface Remembered {
  readonly request: string
  readonly answer: unknown
  readonly at: number
}

const ALLOWLIST: DataKey<string[]> = { name: "resend.allowlist" }
const IDEMPOTENCY: DataKey<Map<string, Remembered>> = { name: "resend.idempotency" }

/** The email a send request describes, or why it cannot be sent. */
function draftOf(body: Record<string, unknown>): Draft | { readonly problem: string } {
  const from = textOf(body.from)
  const to = addresses(body.to)
  const subject = textOf(body.subject)

  if (!from) return { problem: "Missing `from` field." }
  if (to.length === 0) return { problem: "Missing `to` field." }
  if (subject === undefined) return { problem: "Missing `subject` field." }

  return {
    from,
    to,
    subject,
    html: textOf(body.html) ?? null,
    text: textOf(body.text) ?? null,
    cc: addresses(body.cc),
    bcc: addresses(body.bcc),
    reply_to: addresses(body.reply_to),
    tags: tagsOf(body.tags),
    scheduled_at: textOf(body.scheduled_at) ?? textOf(body.scheduledAt) ?? null,
  }
}

/** Every recipient is on the allowlist, when one is set (as on a sandboxed Resend account). */
function allowed(context: ResendRouteContext, draft: Draft): boolean {
  const allowlist = context.store.getData(ALLOWLIST)

  if (!allowlist) return true

  const permitted = new Set(allowlist.map((address) => address.toLowerCase()))

  return [...draft.to, ...(draft.cc ?? []), ...(draft.bcc ?? [])].every((address) =>
    permitted.has(address.replace(/^.*<([^>]+)>$/, "$1").toLowerCase()),
  )
}

/** Stores an accepted email and emits its events: scheduled, or sent then delivered. */
function accept(context: ResendRouteContext, draft: Draft): Email {
  const id = newUuid()
  const now = context.clock()
  const later = draft.scheduled_at !== null && Date.parse(draft.scheduled_at) > now.getTime()
  const email = context.objects.emails.add(
    {
      object: "email",
      id,
      message_id: `<${id}@resend.danwo.test>`,
      created_at: now.toISOString(),
      last_event: later ? "scheduled" : "delivered",
      ...draft,
    },
    null,
  )

  if (later) context.events.email("email.scheduled", email)
  else {
    context.events.email("email.sent", email)
    context.events.email("email.delivered", email)
  }

  return email
}

/**
 * Runs `send` once per idempotency key: a retry with the same body gets the first answer, a
 * different body under the same key is refused. Keys are forgotten after 24 hours.
 */
async function once(
  c: Context,
  context: ResendRouteContext,
  scope: string,
  send: () => Response | Promise<Response>,
): Promise<Response> {
  const key = c.req.header("idempotency-key")

  if (key === undefined) return send()
  if (key.length === 0 || key.length > KEY_LIMIT)
    return resendError(
      c,
      400,
      "invalid_idempotency_key",
      `The idempotency key must be 1-${KEY_LIMIT} characters.`,
    )

  const memory = context.store.getData(IDEMPOTENCY) ?? new Map<string, Remembered>()
  const request = `${scope} ${await c.req.text()}`
  const now = context.clock().getTime()
  const earlier = memory.get(key)

  if (earlier && now - earlier.at < KEY_LIFETIME_MS)
    return earlier.request === request
      ? c.json(earlier.answer)
      : resendError(
          c,
          409,
          "invalid_idempotent_request",
          "Same idempotency key used with a different request payload.",
        )

  const response = await send()

  if (response.ok) {
    memory.set(key, { request, answer: await response.clone().json(), at: now })
    context.store.setData(IDEMPOTENCY, memory)
  }

  return response
}

/** Sends one email from a request body, or answers why not. */
function sendOne(c: Context, context: ResendRouteContext, body: Record<string, unknown>): Response {
  const draft = draftOf(body)

  if ("problem" in draft) return resendError(c, 422, "missing_required_field", draft.problem)
  if (!allowed(context, draft))
    return resendError(
      c,
      403,
      "validation_error",
      "You can only send testing emails to your own email address.",
    )

  return c.json({ id: accept(context, draft).id } satisfies CreateEmailResponseSuccess)
}

/** Sends every email in a batch, or none if one is invalid. */
function sendBatch(c: Context, context: ResendRouteContext, list: unknown): Response {
  const drafts = (Array.isArray(list) ? list : []).map((item: unknown) =>
    draftOf(asRecord(item) ?? {}),
  )
  const ready = drafts.filter((draft): draft is Draft => !("problem" in draft))
  const bad = drafts.find((draft) => "problem" in draft)

  if (drafts.length === 0) return resendError(c, 422, "validation_error", "The batch is empty.")
  if (bad && "problem" in bad) return resendError(c, 422, "missing_required_field", bad.problem)

  if (!ready.every((draft) => allowed(context, draft)))
    return resendError(
      c,
      403,
      "validation_error",
      "You can only send testing emails to your own email address.",
    )

  return c.json({ data: ready.map((draft) => ({ id: accept(context, draft).id })) })
}

/** Sending, reading, listing and canceling emails. */
export function emailRoutes(context: ResendRouteContext): void {
  const { app, objects } = context

  app.post("/emails", async (c) =>
    once(c, context, "send", async () => sendOne(c, context, await jsonBody(c))),
  )

  app.post("/emails/batch", async (c) =>
    once(c, context, "batch", async () =>
      sendBatch(c, context, JSON.parse((await c.req.text()) || "[]")),
    ),
  )

  app.get("/emails", (c) => listOf(c, objects.emails.all().map(listedEmail)))

  app.get("/emails/:id", (c) => {
    const email = objects.emails.get(c.req.param("id"))

    return email ? c.json(email) : notFound(c, "Email")
  })

  app.post("/emails/:id/cancel", (c) => {
    const id = c.req.param("id")
    const email = objects.emails.get(id)

    if (!email) return notFound(c, "Email")
    if (email.last_event !== "scheduled")
      return resendError(c, 422, "validation_error", "Only scheduled emails can be canceled.")

    objects.emails.change(id, { last_event: "canceled" })

    return c.json({ object: "email", id } satisfies CancelEmailResponseSuccess)
  })
}

/** Restricts recipients to `addresses`, as a Resend account that may only send to its owner. */
export function setAllowlist(
  context: Pick<ResendRouteContext, "store">,
  list: readonly string[],
): void {
  context.store.setData(ALLOWLIST, [...list])
}
