/**
 * What each of the benchmark app's paths does: a table from `METHOD /path` to a handler that
 * gets the request's form or body and the app's state, and answers with HTML, JSON or a redirect.
 */
import { randomInt, randomUUID } from "node:crypto"

import { Stripe } from "stripe"
import { z } from "zod"

import type { Bug } from "./bugs.ts"
import * as pages from "./pages.ts"
import {
  createCheckout,
  type Credentials,
  mailCode,
  notifyTeam,
  ProviderError,
} from "./providers.ts"
import { type AppState, freshState, type Order, stateJson } from "./state.ts"

/** What a handler answers. */
export type Answer =
  | { readonly html: string; readonly status?: number }
  | { readonly json: string }
  | { readonly redirect: string }

/** Everything a handler may use. */
export interface Context {
  readonly state: AppState
  readonly bugs: ReadonlySet<Bug>
  readonly credentials: Credentials & { readonly webhookSecret: string }
  /** The app's own origin, e.g. `http://127.0.0.1:4000`. */
  readonly origin: string
  readonly widgetOrigin: string
  readonly form: URLSearchParams
  readonly body: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly path: string
  readonly query: URLSearchParams
  /** Replaces the app's state with a fresh one (test-only reset). */
  resetState(): void
}

type Handler = (ctx: Context) => Answer | Promise<Answer>

const html = (text: string, status?: number): Answer => ({
  html: text,
  ...(status !== undefined && { status }),
})

async function startSignup(ctx: Context): Promise<Answer> {
  const email = ctx.form.get("email") ?? ""
  const code = String(randomInt(100_000, 1_000_000))

  ctx.state.codes.set(email, code)
  await mailCode(email, code, ctx.credentials)

  return html(pages.signupCode(email, false))
}

function verifySignup(ctx: Context): Answer {
  const email = ctx.form.get("email") ?? ""

  if (ctx.state.codes.get(email) !== ctx.form.get("code"))
    return html(pages.signupCode(email, true))

  ctx.state.codes.delete(email)
  ctx.state.accounts.push({ email, verified: true })

  return html(pages.welcome(email))
}

/** A message safe to show a customer; `raw-429` shows the provider's own answer instead. */
function customerMessage(error: unknown, bugs: ReadonlySet<Bug>): string {
  if (error instanceof ProviderError && bugs.has("raw-429") && error.status === 429)
    return `Stripe error ${error.status}: ${error.body}`

  return "We couldn't start your payment. Please try again in a moment."
}

async function pay(ctx: Context): Promise<Answer> {
  const order: Order = {
    id: `ord_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    seats: 2,
    amount: 2400,
    status: "pending",
    paidBy: null,
    sessionId: null,
  }

  ctx.state.orders.push(order)

  try {
    const checkout = await createCheckout(order, ctx.origin, ctx.credentials, ctx.bugs)

    order.sessionId = checkout.id

    return { redirect: checkout.url }
  } catch (error) {
    const message = customerMessage(error, ctx.bugs)

    ctx.state.errorsShown.push(message)

    return html(pages.paymentError(message), 502)
  }
}

function markPaid(state: AppState, order: Order, by: "webhook" | "redirect") {
  order.status = "paid"
  order.paidBy = by
  state.credits += 500 * order.seats
}

function showOrder(ctx: Context): Answer {
  const order = ctx.state.orders.find((o) => `/orders/${o.id}` === ctx.path)

  if (!order) return html(pages.page("Not found", "<p>No such order.</p>"), 404)
  if (
    ctx.query.get("returned") === "1" &&
    ctx.bugs.has("fulfil-on-redirect") &&
    order.status !== "paid"
  )
    markPaid(ctx.state, order, "redirect")

  return html(pages.orderPage(order, ctx.state.credits))
}

const CompletedSession = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.object({ client_reference_id: z.string().nullable() }) }),
})

/** The event a webhook carries: verified against the signing secret unless `no-verify`. */
function eventOf(ctx: Context): z.infer<typeof CompletedSession> {
  if (ctx.bugs.has("no-verify")) return CompletedSession.parse(JSON.parse(ctx.body))

  const signature = ctx.headers["stripe-signature"]
  const stripe = new Stripe(ctx.credentials.stripeKey)
  const event = stripe.webhooks.constructEvent(
    ctx.body,
    typeof signature === "string" ? signature : "",
    ctx.credentials.webhookSecret,
  )

  return CompletedSession.parse(event)
}

/**
 * Stripe's webhook: a completed checkout pays its order once. The event id is remembered and a
 * paid order is never paid again; `no-dedupe` drops both checks.
 */
function stripeWebhook(ctx: Context): Answer {
  let event: z.infer<typeof CompletedSession>

  try {
    event = eventOf(ctx)
  } catch {
    return html("bad signature", 400)
  }

  const dedupe = !ctx.bugs.has("no-dedupe")
  const order = ctx.state.orders.find((o) => o.id === event.data.object.client_reference_id)
  const seen = dedupe && (ctx.state.events.has(event.id) || order?.status === "paid")

  if (event.type === "checkout.session.completed" && order && !seen)
    markPaid(ctx.state, order, "webhook")

  ctx.state.events.add(event.id)

  return { json: '{"received":true}' }
}

/** The settings form's rules; `hidden-validation` skips the email rule. */
function settingsErrors(values: Record<string, string>, bugs: ReadonlySet<Bug>) {
  const errors: Record<string, string> = {}
  const age = Number(values.age)

  if ((values.name ?? "").trim() === "") errors.name = "Name is required"
  if (!bugs.has("hidden-validation") && !(values.email ?? "").includes("@"))
    errors.email = "Enter a valid email address"
  if (!Number.isInteger(age) || age < 13 || age > 120) errors.age = "Age must be between 13 and 120"

  return errors
}

function saveSettings(ctx: Context): Answer {
  const values = {
    name: ctx.form.get("name") ?? "",
    email: ctx.form.get("email") ?? "",
    age: ctx.form.get("age") ?? "",
  }
  const errors = settingsErrors(values, ctx.bugs)
  const ok = Object.keys(errors).length === 0

  if (ok) ctx.state.settings = { ...values, age: Number(values.age) }

  return html(pages.settingsForm(values, errors, ok), ok ? 200 : 422)
}

function settingsPage(ctx: Context): Answer {
  const { name, email, age } = ctx.state.settings

  return html(pages.settingsForm({ name, email, age: String(age) }, {}, false))
}

function deleteProject(ctx: Context): Answer {
  const id = ctx.form.get("id")

  ctx.state.projects = ctx.state.projects.filter((p) => p.id !== id)

  return { redirect: "/projects" }
}

function storeUpload(ctx: Context): Answer {
  const header = ctx.headers["x-file-name"]
  const name = decodeURIComponent(typeof header === "string" ? header : "file")

  ctx.state.uploads.push({ name, bytes: Buffer.byteLength(ctx.body) })

  return { json: '{"ok":true}' }
}

async function notify(ctx: Context): Promise<Answer> {
  await notifyTeam("A teammate asked everyone to look at the dashboard.", ctx.credentials)
  ctx.state.notified += 1

  return { redirect: "/team" }
}

const ROUTES: Readonly<Record<string, Handler>> = {
  "GET /": () => html(pages.home()),
  "GET /signup": () => html(pages.signupForm()),
  "POST /signup": startSignup,
  "POST /signup/verify": verifySignup,
  "GET /checkout": (ctx) => html(pages.cart(ctx.bugs)),
  "POST /checkout/confirm": () => html(pages.challenge()),
  "POST /checkout/pay": pay,
  "GET /orders": (ctx) => html(pages.orderList(ctx.state)),
  "POST /webhooks/stripe": stripeWebhook,
  "GET /settings": settingsPage,
  "POST /settings": saveSettings,
  "GET /products": (ctx) => html(pages.products(ctx.bugs)),
  "GET /projects": (ctx) => html(pages.projects(ctx.state)),
  "POST /projects/delete": deleteProject,
  "GET /upload": (ctx) => html(pages.upload(ctx.state)),
  "POST /upload": storeUpload,
  "GET /newsletter": (ctx) => html(pages.newsletter(ctx.state, ctx.widgetOrigin)),
  "POST /newsletter/subscribe": (ctx) => {
    ctx.state.subscribers.push(ctx.body)

    return { json: '{"ok":true}' }
  },
  "GET /approve": (ctx) => html(pages.approve(ctx.state)),
  "POST /approve": (ctx) => {
    ctx.state.approved = true

    return { json: '{"ok":true}' }
  },
  "GET /team": (ctx) => html(pages.team(ctx.state)),
  "POST /team/notify": notify,
  "GET /report": () => html(pages.report()),
  "GET /report/data": () => ({ json: '{"rows":42}' }),
  "GET /__state": (ctx) => ({ json: stateJson(ctx.state) }),
  "POST /__test/reset": (ctx) => {
    ctx.resetState()

    return { json: '{"ok":true}' }
  },
}

/** The handler for a request: an exact route, else an order page, else none. */
export function routeFor(method: string, path: string): Handler | undefined {
  const exact = ROUTES[`${method} ${path}`]

  if (exact) return exact
  if (method === "GET" && /^\/orders\/ord_[\da-f]{12}$/.test(path)) return showOrder

  return undefined
}

export { freshState }
