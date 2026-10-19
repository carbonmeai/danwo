import type { Context } from "../../http.ts"
import { paymentMethodFor } from "../cards.ts"
import { escapeHtml, formatMoney, messagePage } from "../checkout-page.ts"
import type { StripeRouteContext } from "../context.ts"
import type { Invoice } from "../entities.ts"
import { idOf, listPage, noSuch, readParams, stripeError, text } from "../helpers.ts"
import { collect, defaultMethodOf, periodAmounts } from "../invoicing.ts"
import { currentPeriodEnd, invoicePaid, periodEnd } from "../subscribing.ts"

/** The card an invoice is paid with: the one given, else its subscription's default. */
function methodFor(
  context: StripeRouteContext,
  invoice: Invoice,
  given: string | undefined,
): string | null {
  if (given) return paymentMethodFor(context.objects, given, context.clock())?.id ?? null

  const subscription = context.objects.subscriptions.get(
    idOf(invoice.parent?.subscription_details?.subscription),
  )

  return subscription ? defaultMethodOf(context, subscription) : null
}

/** `POST /v1/invoices/:id/pay`: charges an open invoice to the given card or the default one. */
async function payInvoice(c: Context, context: StripeRouteContext): Promise<Response> {
  const id = c.req.param("id")
  const invoice = context.objects.invoices.get(id)

  if (!invoice) return noSuch(c, "invoice", id)
  if (invoice.status !== "open")
    return stripeError(
      c,
      400,
      "invalid_request_error",
      `Invoice is already ${invoice.status ?? "closed"}`,
      "invoice_not_editable",
    )

  const method = methodFor(context, invoice, text((await readParams(c)).payment_method))
  const { invoice: after, outcome } = collect(context, invoice, method, {
    description: "Subscription update",
  })

  if (outcome === "paid") invoicePaid(context, after)
  if (outcome === "declined")
    return stripeError(c, 402, "card_error", "Your card was declined.", "card_declined")

  return c.json(after)
}

/** `POST /v1/invoices/create_preview`: what the subscription's next renewal will bill. */
async function previewInvoice(c: Context, context: StripeRouteContext): Promise<Response> {
  const params = await readParams(c)
  const id = text(params.subscription) ?? ""
  const subscription = context.objects.subscriptions.get(id)

  if (!subscription || subscription.status === "canceled")
    return stripeError(
      c,
      400,
      "invalid_request_error",
      `No upcoming invoices for customer: ${text(params.customer) ?? ""}`,
      "invoice_upcoming_none",
    )

  const start = currentPeriodEnd(subscription)
  const amounts = periodAmounts(subscription)
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  const latest = context.objects.invoices.get(idOf(subscription.latest_invoice))
  const base: Invoice | undefined = latest

  if (!base) return noSuch(c, "subscription", id, "subscription")

  return c.json({
    ...base,
    id: `upcoming_in_${subscription.id.slice(4)}`,
    amount_due: total,
    amount_paid: 0,
    amount_remaining: total,
    billing_reason: "upcoming",
    created: start,
    number: null,
    period_start: start,
    period_end: start,
    status: "draft",
    subtotal: total,
    subtotal_excluding_tax: total,
    total,
    total_excluding_tax: total,
    lines: {
      ...base.lines,
      data: base.lines.data.map((line, index) => {
        const price = subscription.items.data[index]?.price

        return {
          ...line,
          amount: amounts[index] ?? 0,
          subtotal: amounts[index] ?? 0,
          period: { start, end: price ? periodEnd(start, price) : start },
        }
      }),
    },
  })
}

/**
 * Invoices: Checkout's and subscriptions' are read, listed and paid through the API, and
 * `hosted_invoice_url` shows one. `payments` and `confirmation_secret` appear when expanded.
 */
export function invoiceRoutes(context: StripeRouteContext): void {
  const { app, objects } = context
  const { invoices } = objects

  app.post("/v1/invoices/create_preview", (c) => previewInvoice(c, context))
  app.get("/v1/invoices/:id", (c) => {
    const id = c.req.param("id")
    const invoice = invoices.get(id)

    return invoice ? c.json(invoice) : noSuch(c, "invoice", id)
  })
  app.post("/v1/invoices/:id/pay", (c) => payInvoice(c, context))

  app.get("/v1/invoices", (c) => {
    const customer = c.req.query("customer")
    const status = c.req.query("status")
    const subscription = c.req.query("subscription")

    return listPage(
      c,
      invoices.where(
        (invoice) =>
          (customer === undefined || invoice.customer === customer) &&
          (status === undefined || invoice.status === status) &&
          (subscription === undefined ||
            invoice.parent?.subscription_details?.subscription === subscription),
      ),
      "/v1/invoices",
    )
  })

  app.get("/invoices/:id", (c) => {
    const invoice = invoices.get(c.req.param("id"))

    if (!invoice || invoice.status === "draft")
      return c.html(messagePage("Invoice not found", "There is no such invoice."), 404)

    const paid = invoice.status === "paid"
    const amount = formatMoney(paid ? invoice.amount_paid : invoice.amount_due, invoice.currency)

    return c.html(
      messagePage(
        `Invoice ${invoice.number ?? invoice.id}`,
        paid ? `Paid ${amount}` : `Amount due ${amount}`,
        `<p data-testid="invoice-status">${escapeHtml(invoice.status ?? "")}</p>`,
      ),
    )
  })
}
