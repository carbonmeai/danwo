# Invariants and the fault matrix

An invariant says what must be true however a run went; `danwo matrix` breaks one provider call,
webhook, or call to the app's own database or cache at a time and checks the invariant held.

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
below) and replays the clean run's recorded steps without the model. A provider call a `delay`
fault holds still reaches the emulator after the app's client has given up (a slow server still
acts), but not once its trial has ended: the next trial's restore drops it, so a 10 s delay never
lands its write in the next trial's emulator.

- PASS: the invariant held under the fault (the body may stop early; that is fine).
- FAIL: the invariant broke; the report shows where the body stopped and why.
- INVALID: the fault never fired (the app took another path); rerun with `matrix.rerunInvalid`.
  A call the app makes once per process (a signing key it fetches and caches) is made in the
  clean run only, when the app is cold: `matrix: { warmUp: true }` runs the test once, unrecorded,
  before the clean run, so such a call gets no fault. Use it only when the environment's reset
  puts every app's state back: the clean run starts from what the reset leaves of the warm-up.
- NOT JUDGED: the trial was blocked, inconclusive or hit an infrastructure failure, or its body
  broke before the fault could fire (the error says where).

`--faults "^duplicate"` runs only the faults whose labels match; `danwo spec --topic faults` lists
the labels each provider gets. Without an invariant the body itself must pass under every fault.

The matrix needs the environment to provide `proxy`, `reset()`, and `webhooks` for webhook faults.

With `data` proxies in front of the app's Postgres and Redis, it also plans faults on the
statements and commands the test sent: `reset-after on COMMIT (postgres)`,
`serialization_failure on UPDATE orders (postgres)`, `down 3000ms on BEGIN (postgres)`,
`OOM on INCR rate:login:* (cache)`. `danwo guide infrastructure` covers wiring, labels and
defaults.

Every WebSocket the clean run opened (a realtime channel, a collaboration session) gets two
trials: `upgrade refused on WS <host>/<path>` and `connection dropped on WS <host>/<path>`. A
socket another person's browser opened (`users.open`) is faulted for that person alone: `connection
dropped on WS <host>/<path> for bob` (`--faults "for bob"` runs only theirs). With
`inngestService()` in the environment, each event the test sent gets `status 500`, `reset-after`
(accepted, but the answer lost, so an app that retries sends it twice) and a slow send on
`POST inngest.danwo.test/e/<key>`.

## What gets planned

A real app's clean run can make hundreds of calls and thousands of statements, most of them
repeats or set-up work. The matrix plans faults on the test's **body** only: everything before
the body began (the saved session signing in, fixtures, `beforeEach` hooks) is setup and gets
no faults. A trial arms its fault when the body starts, and counts occurrences from there, so a
route the session also called is still the body's first. `--include-setup` faults setup too.

Setup's work is found by what caused it, not only by when it came. A webhook for a message the
provider emitted before the body began, the calls and statements the app made while answering
it, and the rest of a transaction setup opened all belong to setup, although they arrive once the
body is running. They get no faults, yet still count toward occurrences, so the body's own call
keeps the number a trial sees. Before keeping a session's sign-in, the worker also waits for the
environment to settle, so the sign-in's late webhooks land in setup and not in the trials that
restore it. A plan therefore holds no fault that only setup's leftovers could fire, and the
trials `--plan` prints are the trials the run makes.

A plan within its budget (40 trials by default: `--budget n`, or `matrix.budget`) runs whole.
Over it, the plan is narrowed step by step, the same way every time, until it fits:

1. background work dropped: health checks, metrics, static assets, token refreshes and job-runner
   housekeeping (signing keys are kept: an app that cannot fetch them must refuse tokens);
2. a route or statement repeated in the body faulted on its first occurrence only;
3. each call or statement keeps its most telling faults: a decline, a 5xx and the answer lost
   after the provider acted for a provider write; a 5xx and a slow answer for a read; the answer
   lost after the commit and a serialization failure for a database write; a duplicate, a forgery
   and a late delivery for a webhook;
4. what is still over the budget is cut: races and webhooks first, then writes, then sockets,
   then reads.

The run says what it left out, e.g. `1999 of 2039 possible faults left out: 1608 on setup, 278 on repeats
of a route or statement, 71 lesser fault kinds, 42 over the budget`, and the dashboard's matrix
page shows the same counts. `--all` runs every fault on the body, `--thorough` keeps every fault
kind, `--every-occurrence` faults every repeat.

`danwo matrix <file> --plan` runs the clean trial, prints every planned trial, what was left out,
and about how long the trials would take on the crew, then stops without running a fault.

When the environment can snapshot, a saved session's sign-in from the clean trial is kept in the
worker's starting point, so later trials restore it instead of signing in again. A fault armed at
the body never touched that sign-in. With `--include-setup` every trial signs in afresh, under its
fault.

## Races

Beside the one-call faults, the matrix plans races from what the clean run did, and only where
they can happen:

- `double-submit on POST /buy`: each form post or fetch the page sent to the app that changes
  something is sent twice at once; the page gets the first answer. `#2` names the second such
  request to the same route.
- `2 concurrent users`: the whole test runs as that many people at once, each in a fresh
  browser, and the invariant judges the combined state once. A test asks for it with
  `test("buys the last lamp", { concurrent: 2 }, …)`; nothing else plans it.
- `webhooks before redirect from checkout.stripe.com`: after paying, the browser is kept from
  landing back on the app until the provider's webhooks were delivered. Planned only when the
  clean run delivered webhooks, and only on a return from a site where the browser first did
  something (paid, signed up), not one it only passed through, such as a sign-in handshake.
- `reorder webhooks payment_intent.created, payment_intent.succeeded`: two different webhooks one
  endpoint got in a row arrive the other way round.
- `slow-then-retry 3000ms on POST api.stripe.com/v1/checkout/sessions`: a server-side call that
  moves money is held until the app's client times out (or 3000ms), then processed anyway, so
  the app's retry races the first request. Applies to Stripe's payment paths and to Paystack,
  Flutterwave and Bachs posts.

A race that was planned but did not happen (no second request, no redirect with a webhook
waiting) is INVALID, like any fault that never fired. Each trial's notes say what the race did:
`POST /buy sent twice at once: 303 and 303`, `held the return from checkout.stripe.com until 1
webhook delivery landed`, `user 2: passed`.

`matrix.races` turns them off: `false` for all (a test's own `concurrent` still runs), or one at
a time with `{ doubleSubmit: false }`, `{ beforeRedirect: false }`, `{ webhookOrder: false }`,
`{ slowThenRetry: false }` or `{ slowThenRetry: { ms: 5000 } }`. `--faults` filters them by
label like any fault. A live session's `inject_fault` arms `slow-then-retry …` and
`reorder webhooks …` labels too.

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
| `sqliteSnapshot({ file })`                 | SQLite's online backup of the file        | the backup written back through SQLite's locks                                      | `node:sqlite`, in every Node danwo runs on                               |
| `sqliteWorkerFile(file, workerIndex)`      |                                           | a copy per worker, `app.w0.db`…                                                     |                                                                          |
| `redisSnapshot({ url })`                   | every key `DUMP`ed with its expiry        | `FLUSHDB`, then every key `RESTORE`d                                                | test-sized data                                                          |

```ts
import {
  defineConfig,
  postgresSnapshot,
  postgresWorkerDatabase,
  startApp,
  type StartedApp,
  stripeEnvironment,
} from "@danwo/sdk"

export default defineConfig({
  async environment({ workerIndex }) {
    // Migrate and seed DATABASE_URL's database once before the run; each worker copies it.
    const url = await postgresWorkerDatabase(process.env.DATABASE_URL ?? "", workerIndex)
    const db = postgresSnapshot({ url })
    const stripe = await stripeEnvironment({ seed: () => ({ webhookEndpoints: [/* … */] }) })
    const command = { command: "npm run dev", url: "http://localhost:3000" }
    const start = () => startApp(command, { ...stripe.proxy.env(), DATABASE_URL: url })
    let app: StartedApp = await start()

    return {
      baseUrl: app.url,
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      reset: async () => {
        await stripe.reset()
        await app.stop()
        app = await start()
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
