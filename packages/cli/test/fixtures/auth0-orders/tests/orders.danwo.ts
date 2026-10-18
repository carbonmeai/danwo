import { generateKeyPairSync, sign } from "node:crypto"

import { type Auth0Fixtures, test as base, z } from "@danwo/sdk"

import { keysOf, signedBy } from "../jwt.ts"

const test = base.extend<Auth0Fixtures>()

const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

/** An access token for the orders API that looks right but was signed by someone else's key. */
function forgedToken(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: "https://acme.us.auth0.com/",
    aud: "https://api.orders.test",
    sub: "auth0|mallory",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`

  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`
}

test("shows Ada her orders and refuses a forged token", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("link", { name: "Log in" }).click()
  await screen.getByLabel("Email address").fill("ada@orders.test")
  await screen.getByLabel("Password").fill("Analytical-1")
  await screen.getByRole("button", { name: "Continue" }).click()
  await expect(screen.getByRole("heading", { name: "Signed in as ada@orders.test" })).toBeVisible()

  await screen.getByRole("link", { name: "Your orders" }).click()
  await expect(screen.getByRole("heading", { name: "Your orders" })).toBeVisible()

  const forged = await fetch(`${app.baseUrl}/api/orders`, {
    headers: { authorization: `Bearer ${forgedToken()}` },
  })

  expect(forged.status).not.toBe(200)
}).invariant(async ({ app, auth0, expect }) => {
  /*
   * Whatever failed along the way, the orders API only ever trusted tokens the tenant signed:
   * when its keys can't be fetched, refusing is fine and trusting blindly is not.
   */
  const { accepted } = z
    .object({ accepted: z.array(z.string()) })
    .parse(await (await fetch(`${app.baseUrl}/audit`)).json())
  const jwks = await auth0.fetch(new Request("https://acme.us.auth0.com/.well-known/jwks.json"))
  const keys = keysOf(await jwks.json())

  expect(accepted.filter((token) => !signedBy(keys, token))).toEqual([])
})
