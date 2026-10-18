import { type ClerkFixtures, test as base } from "@danwo/sdk"

import { enterEmail } from "./steps.ts"

const test = base.extend<ClerkFixtures>()

/** One base64url JSON part of a token. */
function part(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

/** A session token for someone else, shaped like Clerk's but signed by nobody. */
function forgedToken(): string {
  const now = Math.floor(Date.now() / 1000)

  return [
    part({ alg: "RS256", kid: "ins_forged", typ: "JWT" }),
    part({ sub: "user_someone_else", sid: "sess_forged", iat: now, nbf: now - 10, exp: now + 600 }),
    "c2lnbmVkLWJ5LW5vYm9keQ",
  ].join(".")
}

test("signs in with Clerk's <SignIn/> and sees their own account", async ({
  app,
  screen,
  expect,
}) => {
  await enterEmail(app, screen)
  await screen.getByLabel("Password", { exact: true }).fill("s3cret-pass")
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(screen.getByRole("heading", { name: "Signed in" })).toBeVisible()
}).invariant(async ({ app, expect }) => {
  /* Whatever Clerk did during the run, the app never believes a session token it cannot verify. */
  const answer = await fetch(new URL("/api/me", app.baseUrl), {
    headers: {
      cookie: `__session=${forgedToken()}; __client_uat=${Math.floor(Date.now() / 1000)}`,
    },
  })

  expect(answer.status).toBe(401)
})
