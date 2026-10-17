import { s3Objects, type S3Fixtures, test as base, z } from "@danwo/sdk"

const test = base.extend<S3Fixtures>()
const Stats = z.object({ logins: z.number(), saved: z.number() })

/** The app's counters: sign-ins it accepted, notes it stored. */
async function statsOf(baseUrl: string) {
  return Stats.parse(await (await fetch(`${baseUrl}/stats`)).json())
}

test.use({ session: "ada" })

test("saves a note", async ({ app, screen, expect }) => {
  await app.open("/notes")
  await screen.getByLabel("Note", { exact: true }).fill("first")
  await screen.getByRole("button", { name: "Save" }).click()

  await expect(screen.getByRole("list", { name: "Saved notes" })).toContainText("first")
}).invariant(async ({ app, s3, expect }) => {
  /*
   * Whichever way saving went, the app counts exactly the notes S3 holds, and it was signed into
   * once: a trial's app starts fresh, so its session was set up again for it.
   */
  const stats = await statsOf(app.baseUrl)

  expect(s3Objects(s3).list("danwo-notes", "notes/").length).toBe(stats.saved)
  expect(stats.logins).toBe(1)
})

test("keeps the browser's storage", async ({ app, screen, expect }) => {
  await app.open("/notes")

  // The setup's visit left `seen` in localStorage; the test's browser starts with it.
  await expect(screen.getByText("Welcome back")).toBeVisible()
  expect((await statsOf(app.baseUrl)).logins).toBe(1)
})

test("starts signed out when it opts out", { session: false }, async ({ app, screen, expect }) => {
  await app.open("/notes")

  await expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible()

  // Then the app ends every session, as a password reset would.
  await fetch(`${app.baseUrl}/logout-everyone`, { method: "POST" })
})

test("signs in again once the app ended every session", async ({ app, screen, expect }) => {
  // The kept sign-in no longer works; the session's check notices and the setup runs again.
  await app.open("/notes")

  await expect(screen.getByRole("heading", { name: "Notes for ada@danwo.test" })).toBeVisible()
  expect((await statsOf(app.baseUrl)).logins).toBe(2)
})
