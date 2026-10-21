import { resendInbox } from "@danwo/sdk"

import { sql } from "./db.ts"
import {
  accountsHold,
  ADA,
  askForCode,
  CODE_SUBJECT,
  KAI,
  LIN,
  links,
  sessionsOf,
  signIn,
  test,
  users,
} from "./harbor.ts"

/** Someone new to Harbor, who signs up with an emailed code. */
const GRACE = "grace@harbor.test"

/** Someone new to Harbor, who signs up with a password. */
const MAE = { email: "mae@harbor.test", name: "Mae Jemison", password: "endeavour-1992" } as const

test("signs up with an emailed code", async ({ app, screen, mail, expect }) => {
  await signIn({ app, screen, mail, expect }, GRACE)

  await expect(screen.getByTestId("signed-in-as")).toHaveText(GRACE)
  await expect(screen.getByTestId("ways-to-sign-in")).toHaveText("Emailed code")
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)
  /* However far the sign-up got, it never made a second Ada, or anyone but Grace. */
  const emails = (await users(fixtures.databaseUrl)).map((user) => user.email)

  fixtures.expect(emails.filter((email) => email !== GRACE)).toEqual([ADA.email])
})

test("signs in with an emailed code", async ({ app, screen, mail, expect, databaseUrl }) => {
  await signIn({ app, screen, mail, expect }, ADA.email)

  await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()
  expect(await sessionsOf(databaseUrl, ADA.email)).toHaveLength(1)
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)
  fixtures.expect(await users(fixtures.databaseUrl)).toEqual([{ id: ADA.id, email: ADA.email }])
})

test("signs in with Google on Google's own page", async ({ app, screen, expect }) => {
  await app.open("/sign-in")
  await screen.getByRole("button", { name: "Continue with Google" }).click()

  /* Google's account chooser, served by the Google emulator: no Google app, no real account. */
  await expect(screen.getByText("Choose an account")).toBeVisible()
  await screen.getByRole("button", { name: `Continue as ${LIN.name}` }).click()

  await expect(screen.getByRole("heading", { name: "Welcome, Lin" })).toBeVisible()
  await expect(screen.getByTestId("ways-to-sign-in")).toHaveText("Emailed code, Google")
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)
  fixtures.expect(await links(fixtures.databaseUrl)).toEqual([`${LIN.email} google`])
})

test("signs in with GitHub on GitHub's own page", async ({ app, screen, expect }) => {
  await app.open("/sign-in")
  await screen.getByRole("button", { name: "Continue with GitHub" }).click()

  await expect(screen.getByRole("heading", { name: /Authorize Harbor/ })).toBeVisible()
  await screen.getByRole("button", { name: `Continue as ${KAI.name}` }).click()

  await expect(screen.getByRole("heading", { name: "Welcome, Kai" })).toBeVisible()
  await expect(screen.getByTestId("signed-in-as")).toHaveText(KAI.email)
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)
  fixtures.expect(await links(fixtures.databaseUrl)).toEqual([`${KAI.email} github`])
})

test("joins Ada's Google sign-in to the account she already has", async ({
  app,
  screen,
  expect,
}) => {
  await app.open("/sign-in")
  await screen.getByRole("button", { name: "Continue with Google" }).click()
  await screen.getByRole("button", { name: `Continue as ${ADA.name}` }).click()

  await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()
  await expect(screen.getByTestId("ways-to-sign-in")).toHaveText("Emailed code, Google")
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)
  /* Google vouches for the address, so Better Auth links it to Ada's row: no second Ada. */
  fixtures.expect(await users(fixtures.databaseUrl)).toEqual([{ id: ADA.id, email: ADA.email }])
})

test(
  "links GitHub from the settings page, then signs in with it",
  { session: "signed-in-ada" },
  async ({ app, screen, expect }) => {
    await app.open("/settings")
    await screen.getByRole("button", { name: "Link GitHub" }).click()
    await screen.getByRole("button", { name: `Continue as ${ADA.name}` }).click()

    await expect(screen.getByRole("status")).toHaveText(
      "GitHub is linked. You can sign in with it now.",
    )
    await expect(screen.getByRole("list", { name: "Linked accounts" })).toContainText("GitHub")
    await expect(screen.getByRole("button", { name: "Link GitHub" })).toBeHidden()

    /* Her GitHub account has another address, yet signing in with it is Ada's account. */
    await screen.getByRole("button", { name: "Sign out of this device" }).click()
    await screen.getByRole("button", { name: "Continue with GitHub" }).click()
    await screen.getByRole("button", { name: `Continue as ${ADA.name}` }).click()
    await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()
    await expect(screen.getByTestId("signed-in-as")).toHaveText(ADA.email)
  },
).invariant(async (fixtures) => {
  await accountsHold(fixtures)
  fixtures.expect(await users(fixtures.databaseUrl)).toEqual([{ id: ADA.id, email: ADA.email }])

  /* However far the link got: GitHub is Ada's, once, or not linked yet. */
  const linked = await links(fixtures.databaseUrl)

  fixtures.expect([[], [`${ADA.email} github`]]).toContainEqual(linked)
})

test("signs up with a password and confirms by email", async ({ app, screen, mail, expect }) => {
  await app.open("/sign-up")
  await screen.getByLabel("Name").fill(MAE.name)
  await screen.getByLabel("Email address").fill(MAE.email)
  await screen.getByLabel("Password").fill(MAE.password)
  await screen.getByRole("button", { name: "Create account" }).click()
  await expect(screen.getByRole("heading", { name: "Confirm your email" })).toBeVisible()

  /* Until she confirms, the password doesn't sign her in. */
  await app.open("/sign-in")
  await screen.getByRole("button", { name: "Sign in with a password instead" }).click()
  await screen.getByLabel("Email address").fill(MAE.email)
  await screen.getByLabel("Password").fill(MAE.password)
  await screen.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(screen.getByRole("alert")).toHaveText(/Confirm your email first/)

  await app.open(await mail.link(MAE.email, { match: "verify-email" }))
  await expect(screen.getByRole("heading", { name: "Welcome, Mae" })).toBeVisible()
  await expect(screen.getByTestId("ways-to-sign-in")).toHaveText("Emailed code, Password")
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)

  const mae = await sql<{ emailVerified: boolean }>(
    fixtures.databaseUrl,
    `select "emailVerified" from "user" where email = $1`,
    [MAE.email],
  )

  fixtures.expect(mae.length, "at most one Mae").toBeLessThanOrEqual(1)
})

test("refuses a wrong code", async ({ app, screen, mail, expect }) => {
  await askForCode({ app, screen, mail, expect }, ADA.email)

  const code = await mail.code(ADA.email)

  await screen.getByLabel("Code").fill(code === "000000" ? "111111" : "000000")
  await screen.getByRole("button", { name: "Sign in", exact: true }).click()

  await expect(screen.getByRole("alert")).toHaveText(/That code isn't right/)
  await expect(screen.getByRole("heading", { name: "Check your email" })).toBeVisible()
}).invariant(accountsHold)

test("stops a code working after three wrong guesses", async ({
  app,
  screen,
  mail,
  expect,
  databaseUrl,
}) => {
  await askForCode({ app, screen, mail, expect }, ADA.email)

  const code = await mail.code(ADA.email)
  const wrong = code === "000000" ? "111111" : "000000"

  for (let guess = 0; guess < 3; guess++) {
    await screen.getByLabel("Code").fill(wrong)
    await screen.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(screen.getByRole("alert")).toHaveText(/That code isn't right/)
  }

  /* Now even the right code is refused: guessing a million codes three at a time gets nowhere. */
  await screen.getByLabel("Code").fill(code)
  await screen.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(screen.getByRole("alert")).toHaveText(/Too many wrong codes/)
  expect(await sessionsOf(databaseUrl, ADA.email)).toEqual([])
})

test("refuses a code once it has expired", async ({ app, screen, mail, expect, time }) => {
  await askForCode({ app, screen, mail, expect }, ADA.email)

  const code = await mail.code(ADA.email)

  /* Harbor's codes last five minutes. */
  await time.travel({ minutes: 6 })
  await screen.getByLabel("Code").fill(code)
  await screen.getByRole("button", { name: "Sign in", exact: true }).click()

  await expect(screen.getByRole("alert")).toHaveText(/That code has expired/)
}).invariant(accountsHold)

test("turns away a fourth code request within five minutes", async ({
  app,
  screen,
  mail,
  expect,
}) => {
  await askForCode({ app, screen, mail, expect }, ADA.email)

  for (let again = 0; again < 2; again++) {
    await screen.getByRole("button", { name: "Send a new code" }).click()
    await expect(screen.getByRole("status")).toHaveText(/We sent a new code/)
  }

  await screen.getByRole("button", { name: "Send a new code" }).click()
  await expect(screen.getByRole("alert")).toHaveText(/Too many tries/)
}).invariant(async (fixtures) => {
  await accountsHold(fixtures)

  const codes = resendInbox(fixtures.resend)
    .list(ADA.email)
    .filter((email) => email.subject === CODE_SUBJECT)

  /* Three requests let through, three emails; the fourth sent nothing. */
  fixtures.expect(codes).toHaveLength(3)
})

test("signs out", { session: "signed-in-ada" }, async ({ app, screen, expect }) => {
  await app.open("/dashboard")
  await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()

  await screen.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(screen.getByRole("heading", { name: "Sign in to Harbor" })).toBeVisible()

  /* The dashboard and settings send a signed-out visitor to sign in. */
  await app.open("/settings")
  await expect(screen.getByRole("heading", { name: "Sign in to Harbor" })).toBeVisible()
}).invariant(async ({ databaseUrl, expect }) => {
  expect(await sessionsOf(databaseUrl, ADA.email), "Ada's session is gone").toEqual([])
})

test(
  "signs out every other device",
  { session: "signed-in-ada" },
  async ({ app, screen, expect, users: people }) => {
    /* Ada signs in on her phone too: a second browser, and a second session. */
    const phone = await people.open("phone")

    await signIn(phone, ADA.email)

    await app.open("/settings")
    const devices = screen.getByRole("list", { name: "Signed-in devices" })

    await expect(devices.getByRole("listitem")).toHaveCount(2)
    await screen.getByRole("button", { name: "Sign out other devices" }).click()
    await expect(screen.getByRole("status")).toHaveText("Signed out 1 other device.")
    await expect(devices.getByRole("listitem")).toHaveCount(1)
    await expect(devices).toContainText("This device")

    /* The phone is signed out the next time it asks; this browser is not. */
    await phone.app.open("/dashboard")
    await phone
      .expect(phone.screen.getByRole("heading", { name: "Sign in to Harbor" }))
      .toBeVisible()
    await app.open("/dashboard")
    await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()
  },
).invariant(async ({ databaseUrl, expect }) => {
  expect(
    await sessionsOf(databaseUrl, ADA.email),
    "only this browser's session is left",
  ).toHaveLength(1)
})
