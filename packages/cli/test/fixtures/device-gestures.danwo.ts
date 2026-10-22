/**
 * Gestures on a real device, copied into the mobile shop by its slow tests: swipes that take a
 * duration, a long press by a reading's ref, and the keyboard put away, twice, so the second call
 * (with no keyboard showing) is seen to leave the screen where it was.
 */
import type { DeviceFixtures } from "@danwo/device"
import { test as base } from "@danwo/sdk"

const test = base.extend<DeviceFixtures>()

test("swipes, long-presses and puts the keyboard away", async ({ screen, expect, device }) => {
  await expect(screen.getByText("Danwo Shop")).toBeVisible()
  await device.swipe({ direction: "down", durationMs: 600 })

  /* No keyboard shows: putting it away leaves the app in front. */
  await device.dismissKeyboard()
  expect((await device.foreground()).browser).toBe(false)
  await expect(screen.getByText("Danwo Shop")).toBeVisible()

  /* The app gives Buy no long-press action, so a held press is a press: Checkout opens. */
  const buy = (await device.read()).nodes.find((node) => node.testId === "buy")

  if (buy === undefined) throw new Error("the shop shows no Buy button")

  await device.longPress(buy.ref, { durationMs: 900 })
  await expect(screen.getByText("Pay danwo")).toBeVisible()

  await screen.getByLabel("Email").fill("buyer@example.com")
  await device.dismissKeyboard()
  await device.dismissKeyboard()
  expect((await device.foreground()).browser).toBe(true)
  await device.swipe({ direction: "down", durationMs: 800 })
  await expect(screen.getByRole("button", { name: "Pay $5.00" })).toBeVisible()
})
