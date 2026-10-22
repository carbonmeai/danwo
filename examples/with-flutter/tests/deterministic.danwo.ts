import { joinedOnce, test } from "./waitlist.ts"

const EMAIL = "ada@lumen.example"

test("shows the waitlist form", async ({ screen, expect }) => {
  /*
   * Every test starts the app afresh on the device; no `app.open` is needed. The field is found by
   * its Semantics identifier: on Android, Flutter hands a text field's label to the accessibility
   * tree only as its hint, which the device driver does not read.
   */
  await expect(screen.getByTestId("email")).toBeVisible()
  await expect(screen.getByRole("button", { name: "Join the waitlist" })).toBeVisible()
})

test("asks for a valid email", async ({ screen, expect }) => {
  await screen.getByTestId("email").fill("ada")
  await screen.getByRole("button", { name: "Join the waitlist" }).tap()

  /* The API refuses it; the app shows the message it answered. */
  await expect(screen.getByTestId("error")).toHaveText("Enter a valid email address.")
})

test("joins the waitlist", async ({ screen, expect }) => {
  await screen.getByTestId("email").fill(EMAIL)
  /* Joining saves the row and calls Resend; readiness waits for both before the next line. */
  await screen.getByTestId("join").tap()

  await expect(screen.getByTestId("status")).toHaveText("You're on the list")
  await expect(screen.getByTestId("waitlist-count")).toHaveText("1")
}).invariant((fixtures) => joinedOnce({ ...fixtures, email: EMAIL }))
