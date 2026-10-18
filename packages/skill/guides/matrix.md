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
(`stripe.snapshot()`, `stripe.restore()`), so an environment adds its app's own data stores.
`@danwo/sdk` has ready-made snapshots for them:

| Helper                                     | Snapshot                                  | Restore                                                                             | Needs                                                                    |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `postgresSnapshot({ url })`                | a template database copied from the app's | the app's database moved aside, the template copied into its place (tens of ms)     | Postgres 14+, a role that may create databases, `pg` in dev dependencies |
| `postgresWorkerDatabase(url, workerIndex)` |                                           | a database of its own per worker, `<db>_w0`, `<db>_w1`… copied from a migrated base | the base migrated first, with nobody connected                           |
| `sqliteSnapshot({ file })`                 | SQLite's online backup of the file        | the backup written back through SQLite's locks                                      | Node 24 (`node:sqlite`)                                                  |
| `sqliteWorkerFile(file, workerIndex)`      |                                           | a copy per worker, `app.w0.db`…                                                     |                                                                          |
| `redisSnapshot({ url })`                   | every key `DUMP`ed with its expiry        | `FLUSHDB`, then every key `RESTORE`d                                                | test-sized data                                                          |

```ts
import {
  defineConfig,
  postgresSnapshot,
  postgresWorkerDatabase,
  stripeEnvironment,
} from "@danwo/sdk"

export default defineConfig({
  async environment({ workerIndex }) {
    // Migrate and seed DATABASE_URL's database once before the run; each worker copies it.
    const url = await postgresWorkerDatabase(process.env.DATABASE_URL ?? "", workerIndex)
    const db = postgresSnapshot({ url })
    const stripe = await stripeEnvironment({ seed: () => ({ webhookEndpoints: [/* … */] }) })
    const app = await startApp({ ...stripe.proxy.env(), DATABASE_URL: url })

    return {
      baseUrl: app.url,
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      reset: async () => {
        await stripe.reset()
        await app.restart()
      },
      snapshot: async () => {
        await stripe.snapshot()
        await db.snapshot()
      },
      restore: async () => {
        await stripe.restore()
        await db.restore()
      },
      close: async () => {
        await app.stop()
        await stripe.close()
        await db.close()
      },
    }
  },
})
```

What the app has to allow:

- **Postgres.** A restore closes every session on the app's database and puts a fresh copy in its
  place under the same name, so the app's pool has to open new connections when old ones are
  closed under it. `pg.Pool` does, as long as it has an `error` listener; pools that cache a
  broken connection need resetting from `onRestore`. `strategy: "swap"` keeps a spare copy ready
  so a restore is two renames: worth it for large databases and trials of a second or more.
- **SQLite.** The app can keep its connection open; it reads the restored rows on its next query.
  A restore waits while the app holds a write transaction open (`busyTimeoutMs`).
- **Everything else the app keeps in memory** (caches, counters, an ORM's identity map) is not in
  the database: clear it from `onRestore`, for example through a test-only reset endpoint.
- **MySQL** has no in-server database copy, so there is no helper for it; reset it with the
  app's own fixtures or a test-only endpoint.

Measured on a Postgres 17 container with a small schema (a 2,000-row catalogue): a restore took
about 20 to 40 ms, a rebuild by migration about 45 ms, and a rebuild plus app restart about
230 ms per trial. The gap grows with the schema and seed data; the restore does not.

An app with in-memory state can expose a test-only reset (the shop example's
`POST /__test/reset`, on only when `SHOP_TEST_RESET=1`); a file-based one can copy its data folder.
