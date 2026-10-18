import type { Context } from "../../http.ts"
import { replaceCard } from "../billing.ts"
import { cardFailure, failureMessage, SUCCESS_CARD } from "../cards.ts"
import { cancelAtPeriodEnd } from "../changes.ts"
import { payCheckout, saveCard } from "../charges.ts"
import type { BachsContext } from "../context.ts"
import type { CheckoutSession, PortalSession } from "../entities.ts"
import { checkoutTotal } from "../formatters.ts"
import { minorOf } from "../helpers.ts"
import {
  checkoutPage,
  notice,
  OVERLAY_SCRIPT,
  paidPage,
  portalPage,
  recoveryPage,
} from "../pages.ts"

/** A text field from a posted form, trimmed; null when empty. */
async function formField(c: Context, name: string): Promise<string | null> {
  const value = (await c.req.parseBody())[name]
  const trimmed = typeof value === "string" ? value.trim() : ""

  return trimmed === "" ? null : trimmed
}

/** A checkout's page when it can no longer be paid. */
function closedPage(checkout: CheckoutSession): string {
  return checkout.status === "expired"
    ? notice("Checkout expired", "This checkout has expired. Return to the store and start again.")
    : notice("Already paid", "This checkout has been completed.")
}

/** A checkout's page when there is none, or it can no longer be paid; nothing when it is open. */
function unpayable(
  checkout: CheckoutSession | undefined,
): { readonly page: string; readonly status: number } | null {
  if (!checkout)
    return { page: notice("Checkout not found", "This link is not valid."), status: 404 }

  return checkout.status === "open" ? null : { page: closedPage(checkout), status: 200 }
}

/** What the buyer entered on the checkout page. */
async function payForm(c: Context) {
  const amount = await formField(c, "amount")

  return {
    card: (await formField(c, "card")) ?? SUCCESS_CARD,
    email: await formField(c, "email"),
    name: await formField(c, "name"),
    amount: amount === null ? null : (minorOf(amount) ?? -1),
  }
}

/** The checkout page and paying it. */
function checkoutPages(context: BachsContext): void {
  const { app, bachs } = context
  const byToken = (token: string) =>
    bachs.checkouts.where((checkout) => checkout.token === token)[0]

  /** Answers with the notice when the token's checkout cannot be paid; otherwise hands it on. */
  const whenPayable = (
    c: Context,
    then: (checkout: CheckoutSession) => Response | Promise<Response>,
  ) => {
    const checkout = byToken(c.req.param("token"))
    const closed = unpayable(checkout)

    return closed || !checkout ? c.html(closed?.page ?? "", closed?.status ?? 404) : then(checkout)
  }

  app.get("/c/:token", (c) =>
    whenPayable(c, (checkout) => c.html(checkoutPage(checkout, checkoutTotal(checkout), null))),
  )

  app.post("/c/:token/pay", (c) =>
    whenPayable(c, async (checkout) => {
      const result = payCheckout(context, checkout, await payForm(c))
      const now = bachs.checkouts.get(checkout.id) ?? checkout

      if (!result.ok) return c.html(checkoutPage(now, checkoutTotal(now), result.message), 402)

      return c.html(paidPage(now.id, now.reference, result.redirect))
    }),
  )

  app.get("/bachs.js", (c) =>
    c.body(OVERLAY_SCRIPT, 200, { "content-type": "text/javascript; charset=utf-8" }),
  )
}

/** The card-update page from a recovery email: a working card pays what is owed and reactivates. */
function recoveryPages(context: BachsContext): void {
  const { app, bachs } = context
  const byToken = (token: string) => bachs.recoveryEmails.where((email) => email.token === token)[0]

  app.get("/recover/:token", (c) =>
    byToken(c.req.param("token"))
      ? c.html(recoveryPage(c.req.param("token"), null))
      : c.html(notice("Link expired", "This link is no longer valid."), 404),
  )

  app.post("/recover/:token", async (c) => {
    const token = c.req.param("token")
    const email = byToken(token)
    const subscription = email ? bachs.subscriptions.get(email.subscriptionId) : undefined

    if (!email || !subscription)
      return c.html(notice("Link expired", "This link is no longer valid."), 404)

    const card = (await formField(c, "card")) ?? SUCCESS_CARD
    const reason = cardFailure(card)

    if (reason) return c.html(recoveryPage(token, failureMessage(reason)), 402)

    replaceCard(context, subscription, saveCard(context, subscription.customerId, card))

    return c.html(notice("Card updated", "Thanks, your subscription is active again."))
  })
}

/** The customer portal behind a portal session's URL. */
function portalPages(context: BachsContext): void {
  const { app, bachs } = context
  const live = (token: string): PortalSession | undefined =>
    bachs.portalSessions.where(
      (s) => s.token === token && Date.parse(s.expiresAt) > context.clock().getTime(),
    )[0]

  app.get("/s/:token", (c) => {
    const session = live(c.req.param("token"))
    const customer = session ? bachs.customers.get(session.customerId) : undefined

    if (!session || !customer)
      return c.html(notice("Session expired", "Open the billing portal again from the app."), 404)

    const rows = bachs.subscriptions
      .where((s) => s.customerId === customer.id)
      .map((subscription) => ({
        subscription,
        name: bachs.products.get(subscription.productId)?.name ?? "Subscription",
      }))

    return c.html(portalPage(session.token, customer.email, rows))
  })

  app.post("/s/:token/cancel/:id", (c) => {
    const session = live(c.req.param("token"))
    const subscription = bachs.subscriptions.get(c.req.param("id"))

    if (!session || subscription?.customerId !== session.customerId)
      return c.html(notice("Session expired", "Open the billing portal again from the app."), 404)
    if (!subscription.cancelAtPeriodEnd && subscription.status !== "canceled")
      cancelAtPeriodEnd(context, subscription, "Canceled in the portal")

    return c.redirect(`/s/${session.token}`, 303)
  })
}

/** Everything Bachs hosts for people rather than servers: checkout, card recovery, the portal, `bachs.js`. */
export function hostedRoutes(context: BachsContext): void {
  checkoutPages(context)
  recoveryPages(context)
  portalPages(context)
}
