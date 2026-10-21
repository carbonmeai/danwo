/*
 * Contract: locators find elements the way a user names them, act on exactly one, and say which
 * locator failed and why. Public API only, so these hold across the runner rewrite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSession } from "../../src/index.ts"
import { type Site, startSite } from "./site.ts"

let site: Site
let session: WebSession

beforeAll(async () => {
  site = await startSite()
  session = await openWebSession({ baseUrl: site.url, actionTimeout: 1_000 })
}, 60_000)

afterAll(async () => {
  await session.close()
  await site.close()
})

beforeEach(async () => {
  await session.app.open("/form")
})

describe("finding elements", () => {
  it("finds by role and accessible name, label, placeholder, text, display value and test id", async () => {
    const { screen } = session

    expect(await screen.getByRole("heading", { name: "Sign up" }).textContent()).toBe("Sign up")
    expect(await screen.getByRole("button", { name: "Save" }).isVisible()).toBe(true)
    expect(await screen.getByLabel("Email").isVisible()).toBe(true)
    expect(await screen.getByLabel("Nickname").isVisible()).toBe(true)
    expect(await screen.getByPlaceholder("Pick a nickname").isVisible()).toBe(true)
    expect(await screen.getByText("Hover me").isVisible()).toBe(true)
    expect(await screen.getByDisplayValue("already here").inputValue()).toBe("already here")
    expect(await screen.getByTestId("status").textContent()).toBe("Not saved")
  })

  // Whether a plain string name matches a substring by default is left to the rewrite.
  it("matches names exactly or by regular expression", async () => {
    const { screen } = session

    expect(await screen.getByRole("button", { name: /^Sa/ }).textContent()).toBe("Save")
    expect(await screen.getByText(/^apple$/i).textContent()).toBe("Apple")
    expect(await screen.getByRole("button", { name: "Save", exact: true }).count()).toBe(1)
    expect(await screen.getByRole("button", { name: "Sav", exact: true }).count()).toBe(0)
  })

  it("narrows a list with first, last, nth and filter, and counts it", async () => {
    const items = session.screen.getByRole("listitem")

    expect(await items.count()).toBe(3)
    expect(await items.first().textContent()).toBe("Apple")
    expect(await items.last().textContent()).toBe("Cherry")
    expect(await items.nth(1).textContent()).toBe("Banana")
    expect(await items.filter({ hasText: "Ch" }).textContent()).toBe("Cherry")
    expect(await items.allTextContents()).toEqual(["Apple", "Banana", "Cherry"])
  })

  it("filters out elements by text or by what they hold", async () => {
    const { screen } = session
    const items = screen.getByRole("listitem")

    expect(await items.filter({ hasNotText: "an" }).allTextContents()).toEqual(["Apple", "Cherry"])
    expect(await items.filter({ hasNot: screen.getByText("Banana") }).count()).toBe(2)
    expect(await items.filter({ hasText: /^C/, hasNotText: "x" }).textContent()).toBe("Cherry")
  })

  it("reads element state", async () => {
    const { screen } = session

    expect(await screen.getByRole("button", { name: "Delete" }).isDisabled()).toBe(true)
    expect(await screen.getByRole("button", { name: "Save" }).isEnabled()).toBe(true)
    expect(await screen.getByText("Hidden note").isVisible()).toBe(false)
    expect(await screen.getByText("Hidden note").isHidden()).toBe(true)
    expect(await screen.getByTestId("status").getAttribute("title")).toBe("status line")
    expect(await screen.getByLabel("Accept terms").isChecked()).toBe(false)
  })
})

describe("acting on elements", () => {
  it("fills, clicks, presses, checks, selects and hovers", async () => {
    const { screen } = session

    await screen.getByLabel("Email").fill("ada@danwo.test")
    expect(await screen.getByLabel("Email").inputValue()).toBe("ada@danwo.test")
    await screen.getByRole("button", { name: "Save" }).click()
    expect(await screen.getByTestId("status").textContent()).toBe("Saved ada@danwo.test")

    await screen.getByLabel("Search").fill("shoes")
    await screen.getByLabel("Search").press("Enter")
    expect(await screen.getByTestId("status").textContent()).toBe("Searched shoes")

    await screen.getByLabel("Accept terms").check()
    expect(await screen.getByLabel("Accept terms").isChecked()).toBe(true)

    await screen.getByLabel("Plan").selectOption("Pro")
    expect(await screen.getByLabel("Plan").inputValue()).toBe("pro")

    await screen.getByText("Hover me").hover()
    expect(await screen.getByText("Hovered").isVisible()).toBe(true)
  })

  it("follows a link to another page", async () => {
    await session.screen.getByRole("link", { name: "Home" }).click()
    await session.screen.getByRole("heading", { name: "Contract site" }).waitFor()
    expect(await session.screen.getByRole("heading", { name: "Contract site" }).isVisible()).toBe(
      true,
    )
  })
})

describe("failing", () => {
  it("names the locator that matched nothing", async () => {
    const missing = session.screen.getByRole("button", { name: "Missing" })

    await expect(missing.click()).rejects.toThrow(/getByRole\("button", name: "Missing"\)/)
  })

  it("refuses to act on a locator that matches more than one element, and says how many", async () => {
    await expect(session.screen.getByRole("listitem").click()).rejects.toThrow(
      /3[^\n]*getByRole\("listitem"\)|getByRole\("listitem"\)[^\n]*3/,
    )
  })

  it("does not act on a disabled element", async () => {
    await expect(
      session.screen.getByRole("button", { name: "Delete" }).click({ timeout: 500 }),
    ).rejects.toThrow(/getByRole\("button", name: "Delete"\)/)
  })
})
