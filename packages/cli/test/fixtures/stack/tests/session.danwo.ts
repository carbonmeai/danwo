import { test } from "@danwo/sdk"

/*
 * A saved session whose setup does real work behind the app: it adds a task, which creates a
 * Stripe customer and sends an Inngest event. The test's body does the same again. Only the
 * body's calls are the test's to fault; the setup's are not.
 */
test.session("visitor", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Add task" }).click()
  await expect(screen.getByRole("status")).toHaveText("Task saved")
})

test.use({ session: "visitor" })

test("adds a task as a returning visitor", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByText("live: pong")).toBeVisible()
  await screen.getByRole("button", { name: "Add task" }).click()
  await expect(screen.getByRole("status")).toHaveText("Task saved")
})
