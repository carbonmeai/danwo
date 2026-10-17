import { describe, it } from "vitest"

import { openWebSession } from "../src/session.ts"
import { startShopEnvironment } from "./environment.ts"

describe("browser journey", () => {
  it("buys credits through the emulated Stripe checkout", async () => {
    const env = await startShopEnvironment()
    const session = await openWebSession({ baseUrl: env.shopUrl, proxy: env.proxy })

    try {
      const { app, screen, expect } = session

      await app.open("/")
      await screen.getByRole("button", { name: "Buy 500 credits" }).click()

      // The emulated Stripe Checkout, served at https://checkout.stripe.com through the proxy.
      await expect(screen.getByTestId("checkout-total")).toContainText("$5.00")
      await screen.getByTestId("checkout-pay").click()

      // Back on the shop; credits arrive once the webhook is delivered.
      await expect(
        screen.getByRole("heading", { name: "Thank you for your purchase" }),
      ).toBeVisible()
      await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 500")
    } finally {
      await session.close()
      await env.close()
    }
  }, 90_000)
})
