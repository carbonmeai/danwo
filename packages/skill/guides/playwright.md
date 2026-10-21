# Using danwo from Playwright Test

Keep existing Playwright tests and add danwo's emulators, proxy, invariants and fault matrix to
them with `@danwo/playwright`.

```ts
// playwright.config.ts
import type { DanwoWorkerFixtures } from "@danwo/playwright"
import { defineConfig } from "@playwright/test"

export default defineConfig<object, Pick<DanwoWorkerFixtures, "danwoConfig">>({
  use: { danwoConfig: "./danwo.config.ts" },
})
```

```ts
// tests/checkout.spec.ts
import { expect, testWith } from "@danwo/playwright"
import type { StripeFixtures } from "@danwo/sdk"

const test = testWith<StripeFixtures>()

test.invariant(async ({ danwo, baseURL }) => {
  expect(await creditsGranted(baseURL)).toBe(await creditsPaid(danwo.stripe))
})

test("buys credits", async ({ page, danwo }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Buy 500 credits" }).click()
  await danwo.settle()
})
```

- Each Playwright worker starts the danwo config's `environment()` once; the browser runs behind
  its proxy and `baseURL` comes from it.
- `danwo` holds the environment's fixtures (`danwo.stripe`…), `proxy`, `settle()`, `exchanges()`,
  `deliveries()`, `inject(label)` to fault the next matching call or webhook, and `clearFaults()`.
- `test.invariant(fn)` runs after each body of the file or describe block.
- A failed test gets a `danwo flight record` attachment next to Playwright's trace.
- `npx @danwo/playwright matrix tests/checkout.spec.ts [--grep] [--faults]` runs the fault matrix
  over one test, judged by its invariant.
