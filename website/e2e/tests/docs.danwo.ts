import { test } from "@danwo/sdk"

test("the docs sidebar reaches a page", async ({ app, screen, expect }) => {
  await app.open("/docs")
  await screen.getByRole("complementary").getByRole("link", { name: "Writing invariants" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Writing invariants" })).toBeVisible()
})

test("docs search finds a page and opens it", async ({ app, screen, expect }) => {
  await app.open("/docs")
  await screen.getByRole("button", { name: /^Search/ }).click()

  const search = screen.getByRole("dialog", { name: "Search" })

  await search.getByRole("combobox", { name: "Search" }).fill("invariants")
  await search.getByRole("option", { name: /Fault matrix Writing invariants$/ }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Writing invariants" })).toBeVisible()
})

test("a docs page offers itself as markdown", async ({ app, screen, expect }) => {
  await app.open("/docs/quickstart")
  await screen.getByRole("button", { name: "Open", exact: true }).click()

  const markdown = screen.getByRole("link", { name: "View as Markdown" })

  await expect(markdown).toHaveAttribute("href", "/docs/quickstart.md")

  /* The browser downloads a markdown file rather than showing it, so the test reads it itself. */
  const response = await fetch(new URL("/docs/quickstart.md", app.baseUrl))

  expect(response.headers.get("content-type")).toContain("text/markdown")
  expect(await response.text()).toMatch(/^# Quickstart/)
})
