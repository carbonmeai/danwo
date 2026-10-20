import { test } from "@danwo/sdk"

test("the settings page looks as it did, the pointer drawn or not", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/")
  /* The pointer, its box and its ripple are on the Save button as the picture is taken. */
  await screen.getByRole("button", { name: "Save" }).click()
  await expect(screen).toHaveScreenshot("settings", { timeout: 1_000 })
})
