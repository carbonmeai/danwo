# @danwo/sdk

What a [dánwò](https://danwo.dev) test file and `danwo.config.ts` import: `test`, `expect`, the
fixtures every test gets (`app`, `screen`, `agent`, `mail`, `secret`), and the environments and
services that start the app and the emulators behind it. Tests are plain async functions, run by
`danwo test` from [`@danwo/cli`](https://www.npmjs.com/package/@danwo/cli).

```ts
// danwo.config.ts
import { appEnvironment, defineConfig, stripeService } from "@danwo/sdk"

export default defineConfig({
  testDir: "tests",
  environment: () =>
    appEnvironment({
      app: { command: "npm run dev", url: "http://localhost:3000" },
      services: [stripeService()],
    }),
})
```

```ts
// tests/checkout.danwo.ts
import { type StripeFixtures, test as base } from "@danwo/sdk"

const test = base.extend<StripeFixtures>()

test("paying shows the receipt", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Pay" }).click()
  await expect(screen.getByText("Thank you")).toBeVisible()
}).invariant(async ({ stripe, expect }) => {
  // However the run went (`danwo matrix` replays it under faults), Stripe answers for it.
  const sessions = await stripe.fetch(new Request("https://api.stripe.com/v1/checkout/sessions"))

  expect(sessions.status).toBe(200)
})
```

The package ships TypeScript declarations, so `tsc` checks your tests against danwo's types.
Documentation: https://danwo.dev. Licensed under the Apache License 2.0.
