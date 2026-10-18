import { isRecord } from "../../json.ts"
import { announce, cancelNow, changeSubscription } from "../billing.ts"
import {
  cancelAtPeriodEnd,
  changeMetadata,
  changePlan,
  changeSeats,
  changeTrial,
  prorationOf,
} from "../changes.ts"
import type { BachsContext } from "../context.ts"
import type { Subscription } from "../entities.ts"
import { subscriptionObject } from "../formatters.ts"
import { BachsFailure, bodyOf, invalid, listPage, text } from "../helpers.ts"

/** The changes a PATCH can carry; exactly one per request. */
const INTENTS = ["product_id", "seats", "trial_end", "metadata"] as const

type Intent = (typeof INTENTS)[number]

function intentOf(body: Record<string, unknown>): Intent {
  const named = INTENTS.filter((intent) => intent in body)

  if (named.length !== 1)
    invalid(`Send exactly one change per request: one of ${INTENTS.join(", ")}`)

  return named[0] ?? "metadata"
}

/** Applies a PATCH's one change and returns the subscription after it. */
function applyChange(
  context: BachsContext,
  subscription: Subscription,
  body: Record<string, unknown>,
): Subscription {
  const intent = intentOf(body)
  const behavior = () => prorationOf(body["proration_behavior"])

  if (intent === "product_id")
    return changePlan(context, subscription, text(body, "product_id") ?? "", behavior())
  if (intent === "seats")
    return changeSeats(context, subscription, Number(body["seats"]), behavior())
  if (intent === "trial_end")
    return changeTrial(context, subscription, text(body, "trial_end") ?? "")

  const metadata = body["metadata"]

  if (metadata !== "" && !isRecord(metadata))
    invalid('metadata must be an object, or "" to clear it')

  return changeSubscription(context, subscription, {
    metadata: changeMetadata(subscription, metadata),
  })
}

function missing(id: string): never {
  throw new BachsFailure(404, "SUBSCRIPTION_NOT_FOUND", `Subscription ${id} not found`)
}

/** Subscriptions: list, retrieve, change (plan, seats, trial, metadata) and cancel. */
export function subscriptionRoutes(context: BachsContext): void {
  const { app, bachs } = context
  const found = (id: string) => bachs.subscriptions.get(id) ?? missing(id)

  app.get("/v1/subscriptions", (c) => {
    const customer = c.req.query("customer_id")
    const status = c.req.query("status")
    const matching = bachs.subscriptions.where(
      (s) => (!customer || s.customerId === customer) && (!status || s.status === status),
    )

    return c.json(
      listPage(
        c,
        matching.toReversed().map((s) => subscriptionObject(s, bachs)),
      ),
    )
  })

  app.get("/v1/subscriptions/:id", (c) =>
    c.json(subscriptionObject(found(c.req.param("id")), bachs)),
  )

  app.patch("/v1/subscriptions/:id", async (c) => {
    const subscription = found(c.req.param("id"))
    const changed = applyChange(context, subscription, await bodyOf(c))

    announce(context, "updated", changed)

    return c.json(subscriptionObject(bachs.subscriptions.get(changed.id) ?? changed, bachs))
  })

  app.delete("/v1/subscriptions/:id", async (c) => {
    const subscription = found(c.req.param("id"))
    const body = await bodyOf(c)
    const reason = text(body, "reason") ?? null

    if (subscription.status === "canceled")
      throw new BachsFailure(
        400,
        "SUBSCRIPTION_ALREADY_CANCELED",
        "The subscription is already canceled",
      )

    const result =
      body["cancel_at_period_end"] === true
        ? cancelAtPeriodEnd(context, subscription, reason)
        : cancelNow(context, subscription, reason)

    return c.json(subscriptionObject(result, bachs))
  })
}
