/**
 * The shop's books and its Stripe webhook: a completed checkout grants its credits, once per event
 * unless SHOP_BUG=no-dedupe turns de-duplication off.
 */
import type { Stripe } from "stripe"

/** Credits per user, as the shop has granted them. */
export const credits = new Map<string, number>()

const handledEvents = new Set<string>()
const dedupe = process.env.SHOP_BUG !== "no-dedupe"

/** The verified event in a webhook request, or undefined if its signature doesn't check out. */
function verifiedEvent(
  stripe: Stripe,
  secret: string,
  body: string,
  signature: string,
): Stripe.Event | undefined {
  try {
    return stripe.webhooks.constructEvent(body, signature, secret)
  } catch {
    return undefined
  }
}

/** Grants a completed checkout's credits; returns false if the event was already handled. */
function grantCredits(event: Stripe.CheckoutSessionCompletedEvent): boolean {
  if (dedupe && handledEvents.has(event.id)) return false

  handledEvents.add(event.id)

  const session = event.data.object
  const user = session.metadata?.user ?? ""

  credits.set(user, (credits.get(user) ?? 0) + Number(session.metadata?.credits ?? 0))

  return true
}

/** The webhook's answer to one request: an HTTP status and a JSON body. */
export function handleWebhook(
  stripe: Stripe,
  secret: string,
  request: { readonly body: string; readonly signature: string },
): { readonly status: number; readonly body: unknown } {
  const event = verifiedEvent(stripe, secret, request.body, request.signature)

  if (!event) return { status: 400, body: { error: "bad signature" } }
  if (event.type === "checkout.session.completed" && !grantCredits(event))
    return { status: 200, body: { duplicate: true } }

  return { status: 200, body: { received: true } }
}

/** Forgets every credit and handled event. */
export function emptyBooks(): void {
  credits.clear()
  handledEvents.clear()
}
