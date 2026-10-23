import { test } from "@danwo/sdk"

test("the home page says what danwo does and leads to the quickstart", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/")
  await expect(
    screen.getByRole("heading", { level: 1, name: "Drive the UI. Judge everything behind it." }),
  ).toBeVisible()
  await expect(screen.getByText("npx @danwo/cli init").first()).toBeVisible()
  await screen.getByRole("link", { name: "Get started" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Quickstart" })).toBeVisible()
})
