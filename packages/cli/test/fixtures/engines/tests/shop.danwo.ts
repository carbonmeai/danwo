import { test } from "@danwo/sdk"

test("creates a Stripe product from the page", async ({ app, screen, agent, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "Lamp shop" })).toHaveScreenshot("heading")
  await screen.getByLabel("Product").fill("Desk lamp")
  await agent.act("press the Create product button")
  await expect(screen.getByRole("status")).toHaveText("Created Desk lamp as a Stripe product")
})
