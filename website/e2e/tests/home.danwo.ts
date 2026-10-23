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
  await expect(screen).toHaveURL("/docs/quickstart")
  await expect(screen.getByRole("heading", { level: 1, name: "Quickstart" })).toBeVisible()
})

test("the setup command's copy button puts the command on the clipboard", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Copy the setup command" }).click()
  expect(await app.clipboard()).toBe("npx @danwo/cli init")
})
