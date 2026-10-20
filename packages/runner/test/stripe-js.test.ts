import { createEmulator, stripe } from "@danwo/emulators"
import { startProxy } from "@danwo/proxy"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { launchBrowser } from "../src/browser/launch.ts"

const SECRET = {
  Authorization: "Bearer sk_test_stripejs",
  "Content-Type": "application/x-www-form-urlencoded",
}

/** A page that loads Stripe.js, mounts a card element, saves the card and pays with it. */
const PAGE = `<!doctype html>
<script src="https://js.stripe.com/v3"></script>
<div id="card"></div>
<button id="save">Save card</button>
<button id="pay">Pay</button>
<p id="out" role="status"></p>
<script>
  const stripe = Stripe("pk_test_stripejs")
  const elements = stripe.elements()
  const card = elements.create("card")
  card.mount("#card")
  const out = document.getElementById("out")
  document.getElementById("save").onclick = async () => {
    const created = await stripe.createPaymentMethod({ type: "card", card })
    if (created.error) return (out.textContent = "error " + created.error.message)
    const setup = await stripe.confirmCardSetup(new URLSearchParams(location.search).get("setup"), {
      payment_method: created.paymentMethod.id,
    })
    out.textContent = setup.error ? "error " + setup.error.message : "setup " + setup.setupIntent.status
  }
  document.getElementById("pay").onclick = async () => {
    const paid = await stripe.confirmCardPayment(new URLSearchParams(location.search).get("pay"), {
      payment_method: { card },
    })
    out.textContent = paid.error ? "error " + (paid.error.decline_code || paid.error.code) : "paid " + paid.paymentIntent.status
  }
</script>`

const emulator = createEmulator(stripe, { baseUrl: "https://checkout.stripe.com" })
let proxy: Awaited<ReturnType<typeof startProxy>>
let browser: Awaited<ReturnType<typeof launchBrowser>>

async function api(path: string, body: string): Promise<{ id: string; client_secret: string }> {
  const response = await emulator.fetch(
    new Request(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: SECRET, body }),
  )

  return z.object({ id: z.string(), client_secret: z.string() }).parse(await response.json())
}

beforeAll(async () => {
  proxy = await startProxy({
    routes: [
      {
        hosts: ["api.stripe.com", "checkout.stripe.com", "js.stripe.com"],
        handler: emulator.fetch,
      },
      {
        hosts: ["shop.danwo.test"],
        handler: async () => new Response(PAGE, { headers: { "content-type": "text/html" } }),
      },
    ],
    unmatched: "block",
  })
  browser = await launchBrowser({ proxy })
})

afterAll(async () => {
  await browser.close()
  await proxy.stop()
  await emulator.close()
})

describe("Stripe.js from the emulator", () => {
  it("loads, mounts a card, saves it with a setup intent and pays with a test card", async () => {
    const setup = await api("setup_intents", "payment_method_types[]=card")
    const intent = await api(
      "payment_intents",
      "amount=500&currency=usd&payment_method_types[]=card",
    )
    const page = await browser.newPage()
    const errors: string[] = []

    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(
      `https://shop.danwo.test/?setup=${setup.client_secret}&pay=${intent.client_secret}`,
    )

    await page.getByLabel("Card number").fill("4242 4242 4242 4242")
    await page.getByRole("button", { name: "Save card" }).click()
    await expect.poll(() => page.getByRole("status").textContent()).toBe("setup succeeded")

    await page.getByRole("button", { name: "Pay" }).click()
    await expect.poll(() => page.getByRole("status").textContent()).toBe("paid succeeded")
    expect(errors).toEqual([])

    await proxy.settled()
    const script = proxy.exchanges().find((exchange) => exchange.host === "js.stripe.com")

    expect(script).toMatchObject({ status: 200, asset: true })
  }, 60_000)

  it("declines with Stripe's decline test card, and refuses a publishable key without the client secret", async () => {
    const intent = await api(
      "payment_intents",
      "amount=500&currency=usd&payment_method_types[]=card",
    )
    const page = await browser.newPage()

    await page.goto(`https://shop.danwo.test/?pay=${intent.client_secret}`)
    await page.getByLabel("Card number").fill("4000 0000 0000 0002")
    await page.getByRole("button", { name: "Pay" }).click()
    await expect.poll(() => page.getByRole("status").textContent()).toBe("error card_declined")

    const unsigned = await emulator.fetch(
      new Request(`https://api.stripe.com/v1/payment_intents/${intent.id}/confirm`, {
        method: "POST",
        headers: { ...SECRET, Authorization: "Bearer pk_test_stripejs" },
        body: "client_secret=wrong",
      }),
    )
    const listing = await emulator.fetch(
      new Request("https://api.stripe.com/v1/customers", {
        headers: { Authorization: "Bearer pk_test_stripejs" },
      }),
    )

    expect([unsigned.status, listing.status]).toEqual([401, 401])
  }, 60_000)
})
