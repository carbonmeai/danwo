import { test } from "@danwo/sdk"

test("the Chinese docs switch to English and back, on the same page", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/zh-CN/docs/quickstart")
  await expect(screen.getByRole("heading", { level: 1, name: "快速开始" })).toBeVisible()

  await screen.getByRole("button", { name: "选择语言" }).click()
  await screen.getByRole("button", { name: "English" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Quickstart" })).toBeVisible()
  await expect(screen).toHaveURL("/docs/quickstart")

  await screen.getByRole("button", { name: "Choose a language" }).click()
  await screen.getByRole("button", { name: "简体中文" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "快速开始" })).toBeVisible()
})

test("a Chinese page links to Chinese pages, and an untranslated one says it is in English", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/zh-CN/docs/quickstart")
  await screen.getByRole("link", { name: "测试第三方服务" }).first().click()
  await expect(screen).toHaveURL("/zh-CN/docs/test-a-provider")
  await expect(screen.getByText("本页还没有中文版，下面是英文原文。")).toBeVisible()
})

test("Chinese search finds a Chinese page", async ({ app, screen, expect }) => {
  await app.open("/zh-CN/docs")
  await screen.getByRole("button", { name: /^搜索/ }).click()

  const search = screen.getByRole("dialog", { name: "搜索" })

  await search.getByRole("combobox", { name: "搜索" }).fill("快速")
  await search.getByRole("option", { name: /快速开始$/ }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "快速开始" })).toBeVisible()
})
