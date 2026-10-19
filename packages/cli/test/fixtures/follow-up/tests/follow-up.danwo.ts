import {
  type Emulator,
  nangoProject,
  nylasApplication,
  test as base,
  unipileWorkspace,
} from "@danwo/sdk"

const test = base.extend<{
  readonly nylas: Emulator
  readonly nango: Emulator
  readonly unipile: Emulator
}>()

test("reads the rep's inbox from Nylas", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByText("Inbox: 1 messages")).toBeVisible()
})

test("sends the follow-up by email, in the CRM and on LinkedIn", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Send follow-up" }).click()
  await expect(screen.getByRole("status")).toHaveText("Follow-up sent")
}).invariant(({ nylas, nango, unipile, expect }) => {
  /* Whatever failed on the way, the lead is never followed up twice anywhere. */
  const emails = nylasApplication(nylas).sent("rep@sales.test")
  const notes = nangoProject(nango)
    .calls()
    .filter((call) => call.path === "/crm/v3/objects/notes")
  const messages = unipileWorkspace(unipile)
    .messages("acc_rep")
    .filter((message) => message.is_sender === 1)

  expect(emails.length).toBeLessThanOrEqual(1)
  expect(notes.length).toBeLessThanOrEqual(1)
  expect(messages.length).toBeLessThanOrEqual(1)
})
