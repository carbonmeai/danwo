import { gmailMailbox, type GoogleFixtures, test as base } from "@danwo/sdk"

const test = base.extend<GoogleFixtures>()

test("syncs a new message after Gmail's push", async ({ app, screen, settle, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Send a note to myself" }).click()
  await expect(screen.getByRole("status")).toHaveText("Sent", { timeout: 3_000 })

  // Gmail's push reaches the app.
  await settle()

  await screen.getByRole("button", { name: "Sync inbox" }).click()
  await expect(screen.getByRole("list", { name: "Synced mail" })).toContainText("Note from danwo", {
    timeout: 3_000,
  })
}).invariant(async ({ app, google, expect }) => {
  /*
   * Whichever way the sync went, each message the app lists is in Ada's inbox and is listed
   * once: a push delivered twice must not list its messages twice.
   */
  const res = await fetch(`${app.baseUrl}/synced`)
  const { synced } = (await res.json()) as { synced: { id: string }[] }
  const ids = synced.map((message) => message.id)
  const inbox = new Set(
    gmailMailbox(google, "ada@danwo.test")
      .inbox()
      .map((m) => m.id),
  )

  expect(ids.length).toBe(new Set(ids).size)
  expect(ids.every((id) => inbox.has(id))).toBe(true)
})
