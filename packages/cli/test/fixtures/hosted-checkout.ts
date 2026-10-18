/**
 * The journey the hosted-checkout shop fixtures share: buy a pack of 500 credits, pay on the
 * provider's own page, then see the credits on the shop's front page.
 */
import type { DanwoFixtures } from "@danwo/sdk"

/** What the journey needs from a test's fixtures. */
export type ShopFixtures = Pick<DanwoFixtures, "app" | "screen" | "expect"> & {
  readonly settle: () => Promise<void>
}

/**
 * Buys one pack: `pay` completes the provider's page, then the shop's `confirmation` heading must
 * show and, once webhooks have landed, the front page must read "Credits: 500".
 */
export async function buyCredits(
  shop: ShopFixtures,
  pay: () => Promise<void>,
  confirmation: string,
): Promise<void> {
  await shop.app.open("/")
  await shop.screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await pay()
  await shop.expect(shop.screen.getByRole("heading", { name: confirmation })).toBeVisible()
  await expectCredits(shop, 1)
}

/** After webhooks land, the front page shows exactly 500 credits per pack paid for. */
export async function expectCredits(shop: ShopFixtures, packs: number): Promise<void> {
  await shop.settle()
  await shop.app.open("/")
  await shop.expect(shop.screen.getByRole("status")).toHaveText(`Credits: ${500 * packs}`)
}
