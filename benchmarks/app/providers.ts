/**
 * The benchmark app's calls to its providers, made the way many apps make them: plain `fetch` to
 * the providers' real hosts, which the test environment routes to emulators without the app
 * knowing.
 */
import { z } from "zod"

import type { Bug } from "./bugs.ts"

/** The fields of a created Checkout Session the app uses. */
const Session = z.object({ id: z.string(), url: z.string() })

/** The keys and tokens the app was started with. */
export interface Credentials {
  readonly stripeKey: string
  readonly resendKey: string
  readonly slackToken: string
}

/** A provider answered with an error the app has to show. */
export class ProviderError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`provider answered ${status}`)
    this.status = status
    this.body = body
  }
}

/** A Checkout Session's id and the hosted page to send the customer to. */
export interface Checkout {
  readonly id: string
  readonly url: string
}

function sessionForm(order: { id: string; amount: number; seats: number }, base: string) {
  return new URLSearchParams({
    mode: "payment",
    client_reference_id: order.id,
    success_url: `${base}/orders/${order.id}?returned=1`,
    cancel_url: `${base}/checkout`,
    "line_items[0][quantity]": String(order.seats),
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(order.amount / order.seats),
    "line_items[0][price_data][product_data][name]": "Pro seat",
  })
}

async function postSession(form: URLSearchParams, key: string, idempotency: string | null) {
  return fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotency !== null && { "idempotency-key": idempotency }),
    },
    body: form,
  })
}

/**
 * Creates the order's Checkout Session, retrying once when the connection drops. The retry sends
 * the same idempotency key, so a session Stripe already created is returned rather than doubled;
 * with `no-idempotency` it sends none.
 */
export async function createCheckout(
  order: { id: string; amount: number; seats: number },
  base: string,
  credentials: Credentials,
  bugs: ReadonlySet<Bug>,
): Promise<Checkout> {
  const form = sessionForm(order, base)
  const key = bugs.has("no-idempotency") ? null : `order-${order.id}`
  const response = await postSession(form, credentials.stripeKey, key).catch(() =>
    postSession(form, credentials.stripeKey, key),
  )
  const body = await response.text()

  if (!response.ok) throw new ProviderError(response.status, body)

  const session = Session.safeParse(JSON.parse(body))

  if (!session.success) throw new ProviderError(502, body)

  return session.data
}

/** Emails a sign-up code through Resend. */
export async function mailCode(email: string, code: string, credentials: Credentials) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.resendKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "Bench <hello@bench.test>",
      to: [email],
      subject: "Your sign-up code",
      text: `Your code is ${code}. It expires in ten minutes.`,
    }),
  })

  if (!response.ok) throw new ProviderError(response.status, await response.text())
}

/** Slack's answer: `ok` says whether the call worked, whatever the HTTP status. */
const SlackAnswer = z.object({ ok: z.boolean() })

/** Posts a message to the team's Slack channel as the app's bot. */
export async function notifyTeam(text: string, credentials: Credentials) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.slackToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel: "general", text }),
  })
  const answer = SlackAnswer.safeParse(await response.json())

  if (!answer.success || !answer.data.ok) throw new ProviderError(response.status, "slack refused")
}
