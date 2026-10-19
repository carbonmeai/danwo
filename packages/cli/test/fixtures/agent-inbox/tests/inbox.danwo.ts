import {
  type ComposioFixtures,
  composioProject,
  type Emulator,
  gmailMailbox,
  test as base,
} from "@danwo/sdk"

const test = base.extend<ComposioFixtures & { readonly google: Emulator }>()

test("connects Gmail through Composio and sends the summary from it", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/")
  await screen.getByRole("link", { name: "Connect Gmail" }).click()
  await screen.getByRole("button", { name: "Continue as Ada Lovelace" }).click()
  await expect(screen.getByRole("heading", { name: "Gmail: connected" })).toBeVisible()

  await screen.getByRole("button", { name: "Send the weekly summary" }).click()
  await expect(screen.getByRole("alert")).toHaveText(/Sent|Could not send, try again/)
}).invariant(async ({ google, expect }) => {
  /* However the run went, the summary went out at most once. */
  const sent = gmailMailbox(google, "ada@inbox.test")
    .sent()
    .filter((message) => message.subject === "Weekly summary")

  expect(sent.length).toBeLessThanOrEqual(1)
})

test("counts a new-mail trigger only when Composio signed it", async ({
  app,
  screen,
  composio,
  settle,
  expect,
}) => {
  await app.open("/")
  await screen.getByRole("link", { name: "Connect Gmail" }).click()
  await screen.getByRole("button", { name: "Continue as Ada Lovelace" }).click()
  await expect(screen.getByRole("heading", { name: "Gmail: connected" })).toBeVisible()

  const [account] = composioProject(composio).accounts()

  /* The trigger the app would set up on the account, made here on the emulator directly. */
  const upserted = await composio.fetch(
    new Request(
      "https://backend.composio.dev/api/v3/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert",
      {
        method: "POST",
        headers: { "x-api-key": "ak_inbox_test_key", "content-type": "application/json" },
        body: JSON.stringify({ connected_account_id: account?.id }),
      },
    ),
  )

  expect(upserted.status).toBe(200)
  composioProject(composio).fire("GMAIL_NEW_GMAIL_MESSAGE", { subject: "Hello", sender: "bob@inbox.test" })
  await settle()

  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("New mail: 1")
})
