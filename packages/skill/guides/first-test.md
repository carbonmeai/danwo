# Writing a first test

Set up a config, write one `*.danwo.ts` file, run it and read the result.

1. Create `danwo.config.ts` next to your tests (`danwo init --starter-config` writes one):

   ```ts
   import { defineConfig } from "@danwo/sdk"

   export default defineConfig({
     testDir: "tests",
     baseUrl: "http://localhost:3000",
   })
   ```

   `baseUrl` is enough when the app already runs. To have danwo start the app with provider
   emulators, give the config an `environment()` instead (see `danwo guide providers`).

2. Write `tests/home.danwo.ts`:

   ```ts
   import { test } from "@danwo/sdk"

   test("shows the plans", async ({ app, screen, expect }) => {
     await app.open("/")
     await screen.getByRole("link", { name: "Pricing" }).click()
     await expect(screen.getByRole("heading", { name: "Plans" })).toBeVisible()
   })
   ```

3. Run it: `danwo test` (all files) or `danwo test home` (paths containing "home").

A test body receives fixtures: `app` (open paths, the base URL), `screen` (locators), `expect`,
`agent` (plain-language steps), `secret` and `mail`. `test.describe`, `beforeEach`/`afterEach`,
`beforeAll`/`afterAll`, `test.only`, `test.skip` and per-test options (`retries`, `timeout`,
`session`) work as you would expect.

Add an invariant when the test touches money, messages or other state behind the app:
`test(...).invariant(fn)` must hold however the body went, and `danwo matrix` judges every
faulted run by it (`danwo guide matrix`).

Exit codes: 0 all passed, 1 a test failed, 2 the config or a call is wrong, 3 the browser,
environment or model provider failed. `danwo spec --topic errors` lists every code.
