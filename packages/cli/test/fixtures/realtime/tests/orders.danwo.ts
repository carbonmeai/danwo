import { type Emulator, novuProject, pusherChannels, test as base, tiptapCollab } from "@danwo/sdk"

const test = base.extend<{
  readonly novu: Emulator
  readonly pusher: Emulator
  readonly tiptap: Emulator
  readonly settle: () => Promise<void>
}>()

test("places an order the page hears of, and writes its note live", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/")
  await expect(screen.getByText("live: connected")).toBeVisible()
  await expect(screen.getByText("note: synced")).toBeVisible()
  await screen.getByRole("button", { name: "Place order" }).click()
  await expect(screen.getByRole("status")).toHaveText("Order o_1 placed")
  await screen.getByRole("button", { name: "Write note" }).click()
  await expect(screen.getByText("note: written")).toBeVisible()
}).invariant(async ({ novu, pusher, tiptap, settle, expect }) => {
  await settle()

  /* One order, one notification, one live event, and the note kept on the server. */
  expect(
    novuProject(novu)
      .inbox("buyer-1")
      .map((message) => message.content),
  ).toEqual(["Order o_1 is on its way"])
  expect(pusherChannels(pusher).events({ channel: "orders", name: "order.placed" })).toHaveLength(1)
  expect(
    await tiptapCollab(tiptap).waitForText("order-notes", "Deliver before noon", {
      timeoutMs: 3_000,
    }),
  ).toBe("Deliver before noon")
})
