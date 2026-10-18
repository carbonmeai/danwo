# Invariants and the fault matrix

An invariant says what must be true however a run went; `danwo matrix` breaks one provider call
or webhook at a time and checks the invariant held.

## Writing the invariant

```ts
test("buys 500 credits", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await screen.getByTestId("checkout-pay").click()
  await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 500")
}).invariant(async ({ app, stripe, expect }) => {
  expect(await creditsGranted(app.baseUrl)).toBe(await creditsPaid(stripe))
})
```

The invariant runs after the body, once background work has settled, with the same fixtures.
Read state from both sides: the app (its API or database) and the emulators (`stripe`,
`resendInbox(resend)`, `slackWorkspace(slack)`…). Good invariants compare the two: credits
granted equal payments captured; one confirmation email per order; one reply per mention.

## Running the matrix

`danwo matrix tests/buy-credits.danwo.ts` runs the test clean, then plans one trial per fault:
each provider call the clean run made × that provider's faults (errors, rate limits, dropped
connections, slow answers), and each webhook delivery × duplicate, late, forged and stale. Every
trial starts from the environment's starting state (reset, or restored from a snapshot; see
below) and replays the clean run's recorded steps without the model.

- PASS: the invariant held under the fault (the body may stop early; that is fine).
- FAIL: the invariant broke; the report shows where the body stopped and why.
- INVALID: the fault never fired (the app took another path); rerun with `matrix.rerunInvalid`.
- NOT JUDGED: the trial was blocked, inconclusive or hit an infrastructure failure.

`--faults "^duplicate"` runs only the faults whose labels match; `danwo spec --topic faults` lists
the labels each provider gets. Without an invariant the body itself must pass under every fault.

The matrix needs the environment to provide `proxy`, `reset()`, and `webhooks` for webhook faults.

## Making it fast

Trials run in parallel, one per worker: `--workers n`, `matrix.workers`, else `workers`, else one
per core (at most 8). Each worker owns its own app, emulators and proxy, so trials never share
state, and `--shuffle <seed>` runs them in another order to prove it. `--max-failures n` stops
starting trials once n failed.

A faulted trial waits for each check at most about three times as long as the clean run needed
for it (at least a second), so a check the fault made impossible fails fast instead of waiting
out its timeout. This applies only to tests with an invariant, which judges such trials anyway;
`matrix.checkPace` tunes it, and `false` turns it off.

The run prints `trial time (median …): prepare · open · body · invariant · settle · close`.
When `prepare` dominates, the environment's reset is the cost (often an app restart or a fresh
database). Give the environment `snapshot()` and `restore()`: the matrix resets each worker
once, snapshots it, then restores before every later trial. The emulator environments have both
(`stripe.snapshot()`, `stripe.restore()`), so an environment adds its app's state:

```ts
async environment({ workerIndex }) {
  const db = `app_test_${workerIndex}`
  const stripe = await stripeEnvironment({ seed: () => ({ webhookEndpoints: [/* … */] }) })
  const app = await startApp({ DATABASE_URL: `postgres://localhost/${db}`, ...stripe.proxy.env() })

  return {
    baseUrl: app.url,
    proxy: stripe.proxy,
    webhooks: stripe.emulator.webhooks,
    fixtures: stripe.fixtures,
    settle: stripe.settle,
    reset: async () => {
      await stripe.reset()
      await app.restart() // migrations and seed data, the slow way
    },
    async snapshot() {
      await stripe.snapshot()
      // Keep the freshly seeded database as a template.
      await psql(`DROP DATABASE IF EXISTS ${db}_kept`)
      await psql(`CREATE DATABASE ${db}_kept TEMPLATE ${db}`)
    },
    async restore() {
      await stripe.restore()
      await app.disconnectDatabase()
      await psql(`DROP DATABASE ${db}`)
      await psql(`CREATE DATABASE ${db} TEMPLATE ${db}_kept`) // a file copy: fast
      await app.connectDatabase()
    },
    close: async () => { await app.stop(); await stripe.close() },
  }
}
```

An app with in-memory state can expose a test-only reset (the shop example's
`POST /__test/reset`, on only when `SHOP_TEST_RESET=1`); a file-based one can copy its data folder.
