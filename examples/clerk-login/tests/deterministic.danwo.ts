import { clerkInstance } from "@danwo/sdk"

import {
  accountsAgree,
  invitedOnce,
  ADA,
  ADA_IDS,
  ADAS_ORG,
  LIN,
  oneAppUserPerClerkUser,
  signIn,
  test,
} from "./lumen.ts"

/** Someone new to Lumen, who signs up in the first test. */
const GRACE = { email: "grace@lumen.test", firstName: "Grace", lastName: "Hopper" } as const

/** Who Ada invites. */
const BOB = "bob@lumen.test"

test("signs up with an emailed code", async ({ app, screen, mail, expect }) => {
  await app.open("/sign-up")
  await screen.getByLabel("First name").fill(GRACE.firstName)
  await screen.getByLabel("Last name").fill(GRACE.lastName)
  await screen.getByLabel("Email address").fill(GRACE.email)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()

  /* Clerk emails a six-digit code; typing the last digit sends it. */
  await screen.getByLabel("Enter verification code").fill(await mail.code(GRACE.email))

  await expect(screen.getByRole("heading", { name: "Welcome, Grace" })).toBeVisible()
  /* The app's own row comes from Clerk's `user.created` webhook, before or after the redirect. */
  await expect(screen.getByRole("status")).toContainText(
    `Lumen has your account for ${GRACE.email}`,
  )
}).invariant(accountsAgree)

test("signs in with an emailed code", async ({ app, screen, mail, expect }) => {
  await signIn({ app, screen, mail, expect }, ADA.email)
  await expect(screen.getByRole("status")).toContainText(`Lumen has your account for ${ADA.email}`)

  await screen
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Profile" })
    .click()
  await expect(screen.getByTestId("profile-name")).toHaveText("Ada Lovelace")
  await expect(screen.getByTestId("profile-clerk-user-id")).toHaveText(ADA_IDS.user)
}).invariant(accountsAgree)

test("signs in with Google on Google's own page", async ({ app, screen, expect }) => {
  await app.open("/sign-in")
  await screen.getByRole("button", { name: /Continue with Google/ }).click()

  /* Google's account chooser, served by the Google emulator: no Google app, no real account. */
  await expect(screen.getByText("Choose an account")).toBeVisible()
  await screen.getByRole("button", { name: `Continue as ${LIN.name}` }).click()

  await expect(screen.getByRole("heading", { name: "Welcome, Lin" })).toBeVisible()
  await screen
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Profile" })
    .click()
  await expect(screen.getByTestId("profile-signs-in-with")).toHaveText("Google, or an emailed code")
}).invariant(async (fixtures) => {
  await accountsAgree(fixtures)
  fixtures.expect(clerkInstance(fixtures.clerk).user(LIN.email)?.first_name).toBe("Lin")
})

test("sends a signed-out visitor from the dashboard to sign in", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/dashboard")

  await expect(screen.getByRole("heading", { name: /Sign in to/ })).toBeVisible()
  await app.open("/organization")
  await expect(screen.getByRole("heading", { name: /Sign in to/ })).toBeVisible()
})

test("signs out", { session: "signed-in-ada" }, async ({ app, screen, expect }) => {
  await app.open("/dashboard")
  await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()

  await screen.getByRole("button", { name: "Open user menu" }).click()
  await screen
    .getByRole("dialog", { name: "Account panel" })
    .getByRole("button", { name: "Sign out" })
    .click()
  await expect(screen.getByRole("heading", { name: /Sign in to/ })).toBeVisible()

  /* The server sees no one, and the browser kept no session cookie for it to see. */
  await app.open("/api/me")
  await expect(screen.getByText(/"userId":null/)).toBeVisible()
  await expect(screen.getByText(/"sessionCookie":false/)).toBeVisible()
}).invariant(async ({ clerk, expect }) => {
  const live = clerkInstance(clerk)
    .sessions(ADA.email)
    .filter((session) => session.status === "active")

  expect(live, "Ada has no session left in Clerk").toEqual([])
})

test(
  "creates an organization and invites Bob, who joins from the email",
  { session: "signed-in-ada" },
  async ({ app, screen, expect, mail, users }) => {
    await app.open("/organization")
    await screen.getByLabel("Organization name").fill("Lumen Labs")
    await screen.getByRole("button", { name: "Create organization" }).click()
    await expect(screen.getByRole("heading", { name: "Lumen Labs" })).toBeVisible()

    await screen.getByLabel("Email address").fill(BOB)
    await screen.getByRole("button", { name: "Send invitation" }).click()
    await expect(screen.getByRole("status")).toHaveText(`Invitation sent to ${BOB}.`)
    await expect(screen.getByRole("list", { name: "Pending invitations" })).toContainText(BOB)

    /*
     * Bob, in a browser of his own, opens the link in Clerk's email. The ticket in it vouches for
     * his address, so Clerk's <SignUp/> signs him up and into Lumen Labs with no code to type.
     */
    const bob = await users.open("bob")

    await bob.app.open(await mail.link(BOB, { match: "ticket" }))
    await bob.expect(bob.screen.getByRole("heading", { name: `Welcome, ${BOB}` })).toBeVisible()

    /* Back in Ada's browser, Bob is a member, in Clerk and in Lumen's own records. */
    await app.open("/organization")
    await screen
      .getByRole("navigation", { name: "Your organizations" })
      .getByRole("link", { name: "Lumen Labs" })
      .click()
    const row = screen.getByRole("row", { name: new RegExp(BOB) })

    await expect(row).toContainText("Member")
    await expect(row).toContainText("Yes")
  },
).invariant(async (fixtures) => {
  await accountsAgree(fixtures)
  await invitedOnce(fixtures, { organization: "Lumen Labs", invitee: BOB })
})

test("refuses a wrong code", async ({ app, screen, expect }) => {
  await app.open("/sign-in")
  await screen.getByLabel("Email address").fill(ADA.email)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
  await screen.getByLabel("Enter verification code").fill("000000")

  await expect(screen.getByRole("paragraph").filter({ hasText: "Incorrect code" })).toBeVisible()
  await expect(screen.getByRole("heading", { name: /Check your email/ })).toBeVisible()
})

test("refuses a code once it has expired", async ({ app, screen, mail, expect, time }) => {
  await app.open("/sign-in")
  await screen.getByLabel("Email address").fill(ADA.email)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()

  const code = await mail.code(ADA.email)

  /* Clerk's codes last ten minutes. */
  await time.travel({ minutes: 11 })
  await screen.getByLabel("Enter verification code").fill(code)

  await expect(screen.getByRole("paragraph").filter({ hasText: /expired/i })).toBeVisible()
  await expect(screen.getByRole("heading", { name: /Check your email/ })).toBeVisible()
}).invariant(oneAppUserPerClerkUser)

/** The ids the seed gave Ada's organization, which the app's database was seeded with too. */
test(
  "shows Ada's seeded organization",
  { session: "ada-org-owner" },
  async ({ app, screen, expect }) => {
    await app.open("/organization")

    await expect(screen.getByRole("heading", { name: ADAS_ORG.name })).toBeVisible()
    await expect(screen.getByRole("row", { name: new RegExp(ADA.email) })).toContainText("Admin")
  },
).invariant(accountsAgree)
