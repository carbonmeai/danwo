/**
 * Billing: the plans, the subscription and its invoices, changing plan, adding a card through
 * Stripe Checkout (in setup mode), and Stripe's billing portal. Every change is read back from
 * Stripe before it is saved, the same way the webhooks save it, so whichever lands first, the page
 * and the webhook agree.
 */
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Stripe } from "stripe"
import { z } from "zod"

import { query } from "../shared/db/client.ts"
import { workspaces } from "../shared/db/schema.ts"
import { PLANS } from "../shared/plans.ts"
import { HttpError } from "./problems.ts"
import { adminOf, membershipOf, type SignedIn, signedIn } from "./session.ts"
import { settings } from "./settings.ts"
import { idempotent, stripe, stripeCall } from "./stripe.ts"
import { priceOf, syncSubscription } from "./subscriptions.ts"
import { WorkspaceId } from "./workspaces.ts"

/** `Visa ending 4242` for a card payment method. */
function cardLabel(method: Stripe.PaymentMethod | string | null): string | null {
  if (method === null || typeof method === "string" || !method.card) return null

  const brand = method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1)

  return `${brand} ending ${method.card.last4}`
}

/**
 * Makes the card a setup-mode Checkout saved the default for the workspace's invoices, then reads
 * the subscription back. Safe to repeat: the return from Checkout and its webhook both call it.
 */
export async function applySetup(sessionId: string): Promise<void> {
  const session = await stripeCall("retrieve checkout session", () =>
    stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] }),
  )
  const workspaceId = session.metadata?.workspace_id
  const intent = typeof session.setup_intent === "object" ? session.setup_intent : null
  const method = intent?.payment_method ?? null
  const methodId = typeof method === "string" ? method : method?.id

  if (session.mode !== "setup" || session.status !== "complete" || !workspaceId || !methodId) return

  const [workspace] = await query("read workspace", (db) =>
    db.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
  )

  if (!workspace?.stripeCustomerId || !workspace.stripeSubscriptionId) return

  const { stripeCustomerId: customer, stripeSubscriptionId: subscription } = workspace

  await stripeCall("set default card", () =>
    stripe.customers.update(customer, { invoice_settings: { default_payment_method: methodId } }),
  )
  await stripeCall("set subscription card", () =>
    stripe.subscriptions.update(subscription, { default_payment_method: methodId }),
  )
  await query("save card", (db) =>
    db
      .update(workspaces)
      .set({ card: cardLabel(method) })
      .where(eq(workspaces.id, workspaceId)),
  )
  await syncSubscription(subscription)
}

const ChangePlan = z.object({ plan: z.enum(PLANS.map((plan) => plan.key)) })

export const billingApi = new Hono<SignedIn>()
  .use(signedIn)
  .get("/workspaces/:id/billing", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const customer = workspace.stripeCustomerId
    const listed = customer
      ? await stripeCall("list invoices", () => stripe.invoices.list({ customer, limit: 12 }))
      : undefined

    return c.json({
      plans: PLANS,
      plan: workspace.plan,
      status: workspace.subscriptionStatus,
      trialEndsAt: workspace.trialEndsAt,
      currentPeriodEnd: workspace.currentPeriodEnd,
      card: workspace.hasPaymentMethod ? (workspace.card ?? "Card on file") : null,
      invoices: (listed?.data ?? []).map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        total: invoice.total,
        currency: invoice.currency,
        created: invoice.created,
        url: invoice.hosted_invoice_url ?? null,
      })),
    })
  })
  .post("/workspaces/:id/billing/plan", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const { plan } = ChangePlan.parse(await c.req.json())
    const id = workspace.stripeSubscriptionId

    if (!id) throw new HttpError(409, "This workspace has no subscription yet.")

    const current = await stripeCall("retrieve subscription", () =>
      stripe.subscriptions.retrieve(id),
    )
    const item = current.items.data[0]

    if (!item) throw new HttpError(409, "This subscription has no plan.")
    if (item.price.id !== priceOf(plan))
      await stripeCall("change plan", () =>
        stripe.subscriptions.update(
          id,
          {
            items: [{ id: item.id, price: priceOf(plan) }],
            proration_behavior: "create_prorations",
          },
          idempotent(`change-${id}-${item.price.id}-to-${plan}`),
        ),
      )

    await syncSubscription(id)

    return c.json({ plan })
  })
  .post("/workspaces/:id/billing/card", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const customer = workspace.stripeCustomerId

    if (!customer) throw new HttpError(409, "This workspace has no billing account yet.")

    const back = `${settings.WEB_URL}/w/${workspace.id}/settings/billing`
    const session = await stripeCall("start card setup", () =>
      stripe.checkout.sessions.create({
        mode: "setup",
        customer,
        currency: "usd",
        metadata: { workspace_id: workspace.id },
        success_url: `${back}?setup={CHECKOUT_SESSION_ID}`,
        cancel_url: back,
      }),
    )

    if (!session.url) throw new HttpError(502, "Stripe gave no page to add a card on.")

    return c.json({ url: session.url })
  })
  .post("/workspaces/:id/billing/card/done", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(await c.req.json())

    await applySetup(sessionId)

    return c.json({ workspaceId: workspace.id })
  })
  .post("/workspaces/:id/billing/portal", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const customer = workspace.stripeCustomerId

    if (!customer) throw new HttpError(409, "This workspace has no billing account yet.")

    const portal = await stripeCall("open billing portal", () =>
      stripe.billingPortal.sessions.create({
        customer,
        return_url: `${settings.WEB_URL}/w/${workspace.id}/settings/billing`,
      }),
    )

    return c.json({ url: portal.url })
  })
