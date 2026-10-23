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

test("the home page and the docs link the package on npm", async ({ app, screen, expect }) => {
  const npm = "https://www.npmjs.com/package/@danwo/cli"

  await app.open("/")
  await expect(screen.getByRole("link", { name: "@danwo/cli on npm" })).toHaveAttribute("href", npm)
  await expect(screen.getByRole("link", { name: "npm", exact: true })).toHaveAttribute("href", npm)

  await app.open("/docs/quickstart")
  await expect(screen.getByRole("link", { name: "@danwo/cli on npm" }).first()).toHaveAttribute(
    "href",
    npm,
  )
})
