import { test } from "@danwo/sdk"

test("connects an account through the provider's popup", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Connect your account" }).click()
  await expect(screen.getByRole("heading", { name: "Connect your account" })).toBeVisible()
  await screen.getByRole("textbox", { name: "Email" }).fill("ada@example.test")
  await screen.getByRole("button", { name: "Allow" }).click()
  await expect(screen.getByText("Connected as ada@example.test")).toBeVisible()
})
