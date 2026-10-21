import { joinedOnce, test } from "./waitlist.ts"

const EMAIL = "ada@lumen.example"

test("shows the waitlist form", async ({ app, screen, expect }) => {
  await app.open("/")

  await expect(screen.getByRole("heading", { name: "Join the waitlist" })).toBeVisible()
  await expect(screen.getByLabel("Work email")).toBeVisible()
})

test("asks for a valid email", async ({ app, screen, expect }) => {
  await app.open("/")

  await screen.getByLabel("Work email").fill("ada")
  await screen.getByRole("button", { name: "Join the waitlist" }).click()

  /* Next.js renders its own empty role=alert (the route announcer), so pick ours by its text. */
  await expect(
    screen.getByRole("alert").filter({ hasText: "Enter a valid email address." }),
  ).toBeVisible()
})

test("joins the waitlist", async ({ app, screen, expect }) => {
  await app.open("/")

  await screen.getByLabel("Work email").fill(EMAIL)
  /* Joining saves the row and calls Resend; readiness waits for both before the next line. */
  await screen.getByRole("button", { name: "Join the waitlist" }).click()

  await expect(screen.getByRole("status")).toContainText("You're on the list")
  await expect(screen.getByTestId("waitlist-count")).toHaveText("1")
}).invariant((fixtures) => joinedOnce({ ...fixtures, email: EMAIL }))
