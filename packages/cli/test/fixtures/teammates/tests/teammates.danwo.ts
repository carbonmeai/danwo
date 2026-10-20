import { test } from "@danwo/sdk"

test("a teammate sees a post the moment it is made", async ({ app, screen, expect, users }) => {
  const message = `Lunch at noon ${Date.now()}`
  const bob = await users.open("bob")

  await bob.app.open("/")
  await bob.expect(bob.screen.getByRole("status", { name: "Connection" })).toHaveText("live")
  await app.open("/")
  await screen.getByRole("textbox", { name: "Message" }).fill(message)
  await screen.getByRole("button", { name: "Post" }).click()
  await bob.expect(bob.screen.getByText(message)).toBeVisible()
  await expect(screen.getByText(message)).toBeVisible()
})
