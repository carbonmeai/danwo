import { portalSessionObject } from "../billing-objects.ts"
import { escapeHtml, formatMoney, messagePage } from "../checkout-page.ts"
import type { StripeRouteContext } from "../context.ts"
import type { Subscription } from "../entities.ts"
import { badParam, newId, noSuch, readParams, text, textOrNull, unix } from "../helpers.ts"
import { cancellationDetails, changeSubscription, currentPeriodEnd } from "../subscribing.ts"

/** One subscription on the portal page, with a button to cancel it at the end of its period. */
function subscriptionRow(session: string, subscription: Subscription): string {
  const item = subscription.items.data[0]
  const amount = formatMoney(item?.price.unit_amount ?? 0, subscription.currency)
  const ending = subscription.cancel_at_period_end
    ? `<p data-testid="cancels-at">Cancels at the end of the period</p>`
    : `<form method="post" action="/p/session/${escapeHtml(session)}/cancel/${escapeHtml(subscription.id)}">
<button type="submit">Cancel plan</button></form>`

  return `<section data-testid="subscription"><h2>${escapeHtml(item?.price.nickname ?? item?.price.id ?? "")}</h2>
<p>${amount} / ${escapeHtml(item?.price.recurring?.interval ?? "month")} · ${escapeHtml(subscription.status)}</p>${ending}</section>`
}

/**
 * The customer portal: `POST /v1/billing_portal/sessions` makes a session whose `url` shows the
 * customer's subscriptions, each of which can be canceled at the end of its period, then sends
 * the customer back to `return_url`.
 */
export function billingPortalRoutes(context: StripeRouteContext): void {
  const { app, objects, events } = context

  app.post("/v1/billing_portal/sessions", async (c) => {
    const params = await readParams(c)
    const customer = text(params.customer)

    if (!customer) return badParam(c, "customer")
    if (!objects.customers.get(customer)) return noSuch(c, "customer", customer, "customer")

    const id = newId("bps")
    const session = objects.portalSessions.add(
      portalSessionObject({
        id,
        created: unix(context.clock()),
        customer,
        returnUrl: textOrNull(params.return_url),
        url: `${context.baseUrl}/p/session/${id}`,
      }),
      null,
    )

    events.emit("billing_portal.session.created", session)

    return c.json(session)
  })

  app.get("/p/session/:id", (c) => {
    const session = objects.portalSessions.get(c.req.param("id"))

    if (!session)
      return c.html(messagePage("Session expired", "This portal session is no longer valid."), 404)

    const rows = objects.subscriptions
      .where((s) => s.customer === session.customer && s.status !== "canceled")
      .map((s) => subscriptionRow(session.id, s))
      .join("")
    const back = session.return_url
      ? `<a data-testid="return" href="${escapeHtml(session.return_url)}">Return</a>`
      : ""

    return c.html(
      messagePage("Manage your subscription", rows ? "" : "No active subscriptions.", rows + back),
    )
  })

  app.post("/p/session/:id/cancel/:subscription", (c) => {
    const session = objects.portalSessions.get(c.req.param("id"))
    const subscription = objects.subscriptions.get(c.req.param("subscription"))

    if (!session || !subscription || subscription.customer !== session.customer)
      return c.html(messagePage("Not found", "There is no such subscription."), 404)

    changeSubscription(context, subscription, {
      cancel_at_period_end: true,
      cancel_at: currentPeriodEnd(subscription),
      canceled_at: unix(context.clock()),
      cancellation_details: cancellationDetails("cancellation_requested"),
    })

    return c.redirect(session.return_url ?? `/p/session/${session.id}`, 303)
  })
}
