import { createEmulator, stripe } from "@danwo/emulators"
import { startProxy } from "@danwo/proxy"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { launchBrowser } from "../src/browser/launch.ts"

describe("browser through the proxy", () => {
  it("opens the emulated Stripe checkout at its real URL and pays", async () => {
    const emulator = createEmulator(stripe, { baseUrl: "https://checkout.stripe.com" })
    const proxy = await startProxy({
      routes: [{ hosts: ["api.stripe.com", "checkout.stripe.com"], handler: emulator.fetch }],
      unmatched: "block",
    })
    const browser = await launchBrowser({ proxy })

    try {
      const auth = { Authorization: "Bearer sk_test_browser" }
      const form = (body: string) =>
        emulator.fetch(
          new Request("https://api.stripe.com/v1/products", {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
            body,
          }),
        )
      const product = z.object({ id: z.string() }).parse(await (await form("name=Credits")).json())
      const session = z.object({ id: z.string(), url: z.string() }).parse(
        await (
          await emulator.fetch(
            new Request("https://api.stripe.com/v1/checkout/sessions", {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
              body: `mode=payment&line_items[0][price_data][currency]=usd&line_items[0][price_data][product]=${product.id}&line_items[0][price_data][unit_amount]=1500&line_items[0][quantity]=1&success_url=https://checkout.stripe.com/done`,
            }),
          )
        ).json(),
      )

      const page = await browser.newPage()
      const response = await page.goto(session.url)

      expect(response?.status()).toBe(200)
      expect(await page.getByTestId("checkout-total").textContent()).toContain("$15.00")

      await page.getByTestId("checkout-pay").click()
      await page.waitForURL("https://checkout.stripe.com/done")

      const paid = z.object({ status: z.string(), payment_status: z.string() }).parse(
        await (
          await emulator.fetch(
            new Request(`https://api.stripe.com/v1/checkout/sessions/${session.id}`, {
              headers: auth,
            }),
          )
        ).json(),
      )

      expect(paid).toMatchObject({ status: "complete", payment_status: "paid" })

      await proxy.settled()
      const hosts = proxy.exchanges().map((e) => `${e.method} ${e.host}${e.path.split("?")[0]}`)

      expect(hosts).toContain(`GET checkout.stripe.com/checkout/${session.id}`)
      expect(hosts).toContain(`POST checkout.stripe.com/checkout/${session.id}/complete`)
    } finally {
      await browser.close()
      await proxy.stop()
      await emulator.close()
    }
  }, 60_000)
})
