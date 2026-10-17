/*
 * An app under test that knows nothing about the proxy: the official Stripe client with its
 * default transport, plain fetch, and a call to another service. Prints what it saw as JSON.
 */
import Stripe from "stripe"

const out = {}
const stripe = new Stripe("sk_test_from_app", { maxNetworkRetries: 0 })

try {
  const customer = await stripe.customers.create({ email: "app@b.co" })

  out.customer = customer.id
  const product = await stripe.products.create({ name: "Credits" })
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      { price_data: { currency: "usd", product: product.id, unit_amount: 500 }, quantity: 1 },
    ],
    success_url: "https://app.test/done",
  })

  out.checkoutUrl = session.url
  const page = await fetch(session.url)

  out.checkoutPage = page.status
} catch (error) {
  out.stripeError = error instanceof Error ? error.message : String(error)
}

try {
  const res = await fetch(process.env.OTHER_SERVICE_URL)

  out.other = res.status
} catch (error) {
  out.otherError = error instanceof Error ? error.message : String(error)
}

console.log(JSON.stringify(out))
