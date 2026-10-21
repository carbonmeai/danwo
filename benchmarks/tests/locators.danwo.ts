/**
 * The benchmark's baseline: every scenario written with locators and expectations only, no model.
 * A scenario locators cannot reach is skipped and counted as a coverage gap, not a pass.
 */
import type { Screen } from "@danwo/sdk"

import {
  accountsVerified,
  borealisDeleted,
  paymentsHold,
  resetApp,
  settingsValid,
  teamNotified,
  test,
} from "./truth.ts"

test.beforeEach(resetApp)

const SIGNUP_EMAIL = "lin@bench.test"

/** Pays for the cart on the open checkout page: continue, approve the payment, then pay. */
async function payForCart(screen: Screen): Promise<void> {
  await screen.getByRole("button", { name: "Continue to payment" }).click()
  await screen.getByRole("button", { name: "Approve payment" }).click()
  await screen.getByTestId("checkout-pay").click()
}

test("signup [locators]", async ({ app, screen, expect, mail }) => {
  await app.open("/signup")
  await screen.getByLabel("Email").fill(SIGNUP_EMAIL)
  await screen.getByRole("button", { name: "Send code" }).click()
  await screen.getByLabel("Code").fill(await mail.code(SIGNUP_EMAIL))
  await screen.getByRole("button", { name: "Verify" }).click()
  await expect(screen.getByRole("status")).toHaveText(`Signed up as ${SIGNUP_EMAIL}`)
}).invariant(accountsVerified)

test("checkout [locators]", async ({ app, screen, expect }) => {
  await app.open("/checkout")
  await expect(screen.getByTestId("cart-total")).toHaveText("$24.00")
  await payForCart(screen)
  await expect(screen.getByTestId("order-status")).toHaveText("Paid")
}).invariant(paymentsHold)

test("orders [locators]", async ({ app, screen, expect }) => {
  await app.open("/checkout")
  await payForCart(screen)
  await app.open("/orders")
  await expect(screen.getByRole("table", { name: "Orders" })).toContainText("Paid")
  await expect(screen.getByRole("status")).toContainText("Credits: ")
}).invariant(paymentsHold)

test("settings [locators]", async ({ app, screen, expect }) => {
  await app.open("/settings")
  await screen.getByLabel("Email").fill("ada-at-lovelace")
  await screen.getByRole("button", { name: "Save settings" }).click()
  await expect(screen.getByRole("alert")).toHaveText("Enter a valid email address")
  await screen.getByLabel("Email").fill("ada@lovelace.test")
  await screen.getByRole("button", { name: "Save settings" }).click()
  await expect(screen.getByRole("status")).toHaveText("Settings saved")
}).invariant(settingsValid)

test("products [locators]", async ({ app, screen, expect }) => {
  await app.open("/products")
  await screen.getByRole("button", { name: "Next" }).click()
  await screen.getByRole("button", { name: "Next" }).click()
  await expect(screen.getByRole("status")).toHaveText("Page 3 of 3 · 30 products")
  await screen.getByLabel("Filter").fill("software")
  await expect(screen.getByRole("status")).toHaveText("Page 1 of 1 · 10 products")
  await screen.getByRole("button", { name: "Price" }).click()
  await expect(screen.getByRole("table", { name: "Products" })).toContainText("Product 22")
})

test("projects [locators]", async ({ app, screen, expect }) => {
  await app.open("/projects")
  await screen.getByRole("button", { name: "Delete Borealis" }).click()
  await expect(screen.getByRole("dialog")).toContainText("Delete Borealis?")
  await screen.getByRole("button", { name: "Delete project" }).click()
  await expect(screen.getByRole("status")).toHaveText("2 projects")
}).invariant(borealisDeleted)

test("upload [locators]", async ({ app, screen, expect }) => {
  await app.open("/upload")
  await screen.getByLabel("Attachment").setInputFiles("notes")
  await screen.getByRole("button", { name: "Upload file" }).click()
  await expect(screen.getByRole("status")).toHaveText("Uploaded notes.txt (49 bytes)")
})

/* Locators address the page, not the documents of frames from other origins. */
test.skip("newsletter [locators]", async () => {})

test("approve [locators]", async ({ app, screen, expect }) => {
  await app.open("/approve")
  await screen.getByTestId("board").click()
  await expect(screen.getByRole("status")).toHaveText("Approved")
})

test("team [locators]", async ({ app, screen, expect }) => {
  await app.open("/team")
  await screen.getByRole("button", { name: "Notify the team" }).click()
  await expect(screen.getByRole("status")).toHaveText("Team notified")
}).invariant(teamNotified)

test("report [locators]", async ({ app, screen, expect }) => {
  await app.open("/report")
  await screen.getByRole("button", { name: "Generate report" }).click()
  await expect(screen.getByRole("status")).toHaveText("Ready: 42 rows")
})
